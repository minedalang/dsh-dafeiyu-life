/**
 * Explicit, UI-initiated repair of the Windows DSH vision-only interpreter.
 * No shell / PowerShell / elevation / ACL change / main .venv replacement.
 * Results contain only finite stage and reason enums, not process output.
 */
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync} from 'node:fs'
import {join,resolve,relative,sep,isAbsolute} from 'node:path'
import {visionPythonCandidates,probeVisionPython,VISION_PYTHON_PROBE_SOURCE,visionPythonTempEnv} from './vision-python-runtime.mjs'

const MAX_CANDIDATES=16
const MAX_BASE_ATTEMPTS=4
const within=(parent,child)=>{
  const a=resolve(parent),b=resolve(child),r=relative(a,b)
  return r===''||!!r&&r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)
}
const FAIL=Object.freeze({
  no_python:'no_healthy_base_python',
  create:'vision_venv_creation_failed',
  pip:'vision_dependencies_install_failed',
  verify:'vision_environment_unhealthy',
  persist:'vision_path_save_failed',
  busy:'repair_already_running',
})

// Fixed argv only. Do not log stderr/stdout (pip may print private paths).
export function runVisionRepairProcess(command,args,{cwd,env,timeoutMs=180000}={}){
  return new Promise(resolveResult=>{
    let child,done=false,timer
    const finish=(result)=>{if(done)return;done=true;clearTimeout(timer);resolveResult(result)}
    try{
      child=spawn(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore','ignore','ignore']})
      let timedOut=false
      timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},timeoutMs)
      child.once('error',()=>finish({ok:false,reason:'process_start_failed'}))
      child.once('close',code=>finish({ok:!timedOut&&code===0,reason:timedOut?'timeout':code===0?'ok':'nonzero_exit'}))
    }catch{finish({ok:false,reason:'process_start_failed'})}
  })
}

// Use an async, bounded stdin probe so discovering a blocked interpreter does
// not freeze the DSH host or starve Life/DM while the UI waits for repair.
export async function probeVisionPythonAsync(python,{home,env=process.env,requiresMcp=true,timeoutMs=5000}={}){
  const result=await new Promise(resolveResult=>{
    let child,done=false,timedOut=false,timer,stdout=''
    const finish=r=>{if(done)return;done=true;clearTimeout(timer);resolveResult(r)}
    try{
      child=spawn(python,['-I','-'],{cwd:home,env:{...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},
        shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']})
      child.stdout.on('data',data=>{
        stdout+=String(data)
        if(stdout.length>2048){timedOut=true;child.kill()}
      })
      child.stdin.on('error',()=>{})
      child.stdin.end(VISION_PYTHON_PROBE_SOURCE)
      timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},timeoutMs)
      child.once('error',()=>finish({status:1,stdout:''}))
      child.once('close',code=>finish({status:timedOut?1:code,stdout:timedOut?'':stdout}))
    }catch{finish({status:1,stdout:''})}
  })
  // Reuse the exact same fail-closed receipt parser as the production selector.
  return probeVisionPython(python,{home,env,requiresMcp,execute:()=>result})
}

export function createVisionEnvironmentRepair({home,workdir,runtimeRoot=home,requirementsFile,env=process.env,
  configured=()=>'',preferred=()=>'',persist=async()=>true,
  probe=probeVisionPythonAsync,run=runVisionRepairProcess,findUv=async()=>'',
  platform=process.platform,clock=()=>Date.now(),random=()=>randomBytes(4).toString('hex'),cooldownMs=600000}={}){
  let active=false, lastFailedAt=null
  let report={state:'idle',stage:'idle',reason:'not_run',checked:0,at:0}
  const snapshot=()=>({...report,installing:active})
  const update=(state,stage,reason='not_run',extra={})=>{report={state,stage,reason,checked:report.checked,at:clock(),...extra}}

  const runRepair=async()=>{
    if(active)return {ok:false,reason:FAIL.busy}
    // A failed UI repair must not create more .vision-env-* folders on each click.
    // A new host process may retry after the underlying Windows policy changes.
    if(lastFailedAt!==null&&clock()-lastFailedAt>=0&&clock()-lastFailedAt<cooldownMs){
      update('failed','discover','repair_retry_cooldown');return snapshot()
    }
    active=true
    let attemptedNewEnvironment=false
    report={state:'running',stage:'discover',reason:'not_run',checked:0,at:clock()}
    try{
      if(platform!=='win32'||!home||!runtimeRoot||!requirementsFile||!existsSync(home)||!existsSync(requirementsFile)){
        update('failed','discover','unsupported_or_missing_installation');return snapshot()
      }
      if(lstatSync(home).isSymbolicLink()||!lstatSync(home).isDirectory()){
        update('failed','discover','unsafe_duty_home');return snapshot()
      }
      // An external user-selected path is NOT necessarily a trusted installation
      // directory. Until Harness can attest a protected runtime and fixed worker
      // entry point, do not create OR activate an arbitrary Medium Python here.
      // In a migrated Windows installation, doing so might elevate execution of
      // Agent-writable scripts, or recreate a Low executable under Duty Home.
      // Only Harness can repair the work/integrity boundary; this UI remains
      // non-destructive and cannot edit ACLs or relabel legacy executables.
      const mediaRoot=String(env.DSH_MEDIA_CACHE_HOME||'')
      if(platform==='win32'&&mediaRoot&&isAbsolute(mediaRoot)&&!within(home,mediaRoot)){
        update('failed','prepare_runtime','trusted_host_runtime_required');return snapshot()
      }
      // The runtime destination follows the selected Python storage partition;
      // the DSH home still owns private temp files and the repair working directory.
      try{
        mkdirSync(runtimeRoot,{recursive:true,mode:0o700})
        if(lstatSync(runtimeRoot).isSymbolicLink()||!lstatSync(runtimeRoot).isDirectory())throw Error('unsafe runtime root')
      }catch{update('failed','prepare_runtime','python_runtime_destination_unavailable');return snapshot()}
      // Prepare one pre-existing plugin-local temp directory BEFORE starting any
      // restricted Python/uv child. A blocked system TEMP is not a broken Python.
      let repairEnv
      try{repairEnv=visionPythonTempEnv({home,env,create:true})}
      catch{update('failed','prepare_temp','vision_temp_unavailable');return snapshot()}
      const runtimeMoved=resolve(runtimeRoot)!==resolve(home)
      const candidates=visionPythonCandidates({preferred:preferred(),configured:configured(),home,workdir,env:repairEnv,platform})
        // If the user explicitly moved managed Python runtimes, do not silently
        // reuse an old plugin-owned interpreter from the previous home. External
        // user-configured Python installs remain eligible as clean rebuild bases.
        .filter(candidate=>!runtimeMoved||!within(home,candidate)||within(runtimeRoot,candidate))
        .slice(0,MAX_CANDIDATES)
      const healthyBases=[]
      for(const candidate of candidates){
        const healthy=await probe(candidate,{home,env:repairEnv,requiresMcp:false})
        report.checked++
        if(!healthy.ok)continue
        const usable=await probe(candidate,{home,env:repairEnv,requiresMcp:true})
        if(usable.ok){
          update('running','save')
          try{if(await persist(candidate)!==false){update('ready','complete','already_healthy');return snapshot()}}
          catch{}
          update('failed','save',FAIL.persist);return snapshot()
        }
        if(healthyBases.length<MAX_BASE_ATTEMPTS)healthyBases.push(candidate)
      }
      // A newly created interpreter may be blocked even if its base Python is
      // usable. Try separate, freshly allocated environments from other healthy
      // bases rather than committing the first unreadable interpreter.
      // Never mutate an existing Python environment, permissions or ACLs.
      const uv=await findUv().catch(()=> '')
      if(!healthyBases.length&&!uv){update('failed','discover',FAIL.no_python);return snapshot()}
      const attempts=healthyBases.length?healthyBases:[null]
      let lastStage='create',lastReason=FAIL.create
      for(const [attempt,base] of attempts.entries()){
        const dest=join(runtimeRoot,'.vision-env-'+String(clock())+'-'+String(random()).replace(/[^a-f0-9]/g,'').slice(0,8)+'-'+attempt)
        if(existsSync(dest)){lastStage='create';lastReason='vision_destination_conflict';continue}
        const childPython=join(dest,'Scripts','python.exe')
        update('running','create')
        attemptedNewEnvironment=true
        let newVenv=base?await run(base,['-m','venv','--copies',dest],{cwd:home,env:repairEnv,timeoutMs:180000}):
          await run(uv,['venv','--seed','--python','3.12',dest],{cwd:home,env:repairEnv,timeoutMs:480000})
        // uv may replace only the freshly allocated destination for this
        // attempt; never touch a previous environment or the main .venv.
        if(base&&(!newVenv?.ok||!existsSync(childPython))&&uv)
          newVenv=await run(uv,['venv','--clear','--seed','--python',base,dest],{cwd:home,env:repairEnv,timeoutMs:480000})
        if(!newVenv?.ok||!existsSync(childPython)){
          lastStage='create';lastReason=FAIL.create;continue
        }
        const readable=await probe(childPython,{home,env:repairEnv,requiresMcp:false})
        if(!readable.ok){lastStage='verify';lastReason=readable.reason||FAIL.verify;continue}
        update('running','install')
        const args=['-m','pip','install','--disable-pip-version-check','-r',requirementsFile]
        const mirrors=[...new Set([
          String(env.BILI_DUTY_PIP_MIRROR||'https://pypi.tuna.tsinghua.edu.cn/simple'),
          'https://mirrors.ustc.edu.cn/pypi/simple','https://mirrors.aliyun.com/pypi/simple'])]
        let installed=false
        for(const mirror of mirrors){
          if((await run(childPython,[...args,'-i',mirror],{cwd:home,env:repairEnv,timeoutMs:300000}))?.ok){installed=true;break}
        }
        if(!installed&&uv)for(const mirror of mirrors){
          if((await run(uv,['pip','install','--python',childPython,'-r',requirementsFile,'-i',mirror],
            {cwd:home,env:repairEnv,timeoutMs:300000}))?.ok){installed=true;break}
        }
        if(!installed){lastStage='install';lastReason=FAIL.pip;continue}
        update('running','verify')
        const final=await probe(childPython,{home,env:repairEnv,requiresMcp:true})
        if(!final.ok){lastStage='verify';lastReason=final.reason||FAIL.verify;continue}
        update('running','save')
        try{if(await persist(childPython)===false){update('failed','save',FAIL.persist);return snapshot()}}
        catch{update('failed','save',FAIL.persist);return snapshot()}
        update('ready','complete','healthy_installed');return snapshot()
      }
      update('failed',lastStage,lastReason);return snapshot()
    }catch{update('failed',report.stage,'repair_unexpected_failure');return snapshot()}
    finally{
      active=false
      if(report.state==='failed'&&attemptedNewEnvironment)lastFailedAt=clock()
      else if(report.state==='ready')lastFailedAt=null
    }
  }
  return {start(){
      if(active)return {ok:false,busy:true,reason:FAIL.busy}
      if(lastFailedAt!==null&&clock()-lastFailedAt>=0&&clock()-lastFailedAt<cooldownMs)
        return {ok:false,reason:'repair_retry_cooldown'}
      void runRepair();return {ok:true,started:true}},status:snapshot,
    // for unit-testing the same installer without filesystem changes
    run:runRepair}
}
