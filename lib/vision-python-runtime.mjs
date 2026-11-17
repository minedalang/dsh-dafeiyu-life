/**
 * Windows vision Python selection with unprivileged write and import probes.
 * No ACL edits, administrative elevation, shell, network, paths or secrets in receipts.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, lstatSync} from 'node:fs'
import {isAbsolute, join, parse, resolve} from 'node:path'

const REQUIRED_MODULES=Object.freeze(['mcp','bilibili_api','qrcode','PIL'])
export const VISION_PYTHON_PROBE_SOURCE = `import sys,os,uuid,pathlib,json,importlib.util\n`+
`out={'ok':False,'version':sys.version_info[:2],'deps':False,'stage':'','writes':{'temp':False,'duty_home':False}}\n`+
`for label,root in (('temp',os.environ.get('TEMP') or os.environ.get('TMP')),('duty_home',os.getcwd())):\n`+
`  if root:\n`+
`    p=pathlib.Path(root)/('dsh-vision-health-'+uuid.uuid4().hex+'.tmp')\n`+
`    try:\n`+
`      p.write_bytes(b'1')\n`+
`      p.unlink()\n`+
`      out['writes'][label]=True\n`+
`    except OSError: pass\n`+
`out['ok']=all(out['writes'].values())\n`+
`if not out['writes']['temp']: out['stage']='temp'\n`+
`elif not out['writes']['duty_home']: out['stage']='duty_home'\n`+
`try:\n`+
`  out['missingModules']=[m for m in ('mcp','bilibili_api','qrcode','PIL') if importlib.util.find_spec(m) is None]\n`+
`  out['deps']=not out['missingModules']\n`+
`except (ImportError,ValueError,AttributeError):\n`+
`  out['missingModules']=list(('mcp','bilibili_api','qrcode','PIL'))\n`+
`print('VISION_PYTHON_CHECK:'+json.dumps(out,separators=(',',':')))\n`

const safePath=(path)=>{
  const p=String(path||'').trim()
  if(!p||!isAbsolute(p)||!p.toLowerCase().endsWith('python.exe'))return ''
  try{if(!existsSync(p)||lstatSync(p).isSymbolicLink()||!lstatSync(p).isFile())return ''}catch{return ''}
  return p
}

export function visionPythonCandidates({preferred='',configured='',home='',workdir='',env=process.env,platform=process.platform}={}){
  // preferred is the explicit vision interpreter when invoked by the vision path;
  // configured is the main duty venv. No guessed interpreter outranks either.
  const raw=[preferred,configured,env.BILI_DUTY_VISION_PYTHON]
  if(platform==='win32'){
    const drives=new Set([parse(String(workdir||'')).root,parse(String(home||'')).root])
    for(const root of drives)if(root){raw.push(join(root,'Anaconda3','python.exe'),join(root,'miniconda3','python.exe'))}
    for(const prefix of [env.CONDA_PREFIX,env.USERPROFILE,env.LOCALAPPDATA,env.ProgramFiles])if(prefix){
      raw.push(join(prefix,'python.exe'),join(prefix,'Anaconda3','python.exe'),join(prefix,'miniconda3','python.exe'))
      for(const version of ['313','312','311','310'])raw.push(join(prefix,'Programs','Python','Python'+version,'python.exe'),join(prefix,'Python'+version,'python.exe'))
    }
    // DSH Desktop doesn't inherit the user's activated (base) shell. Search
    // interpreter paths advertised by the actual Desktop process as well.
    for(const part of String(env.Path||env.PATH||'').split(';'))if(part&&isAbsolute(part))raw.push(join(part,'python.exe'))
  }
  const seen=new Set()
  return raw.map(safePath).filter(p=>{if(!p)return false;const key=resolve(p).toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,16)
}

export function probeVisionPython(python,{home='',env=process.env,requiresMcp=true,execute=spawnSync}={}){
  const p=safePath(python)
  if(!p||!home||!isAbsolute(home))return {ok:false,reason:'missing_runtime'}
  // Normal site-packages, but isolated from PYTHONPATH and user site configuration.
  // Fixed code is piped via stdin; no user-supplied code or shell interpolation.
  try{
    const result=execute(p,['-I','-'],{cwd:home,env:{...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},input:VISION_PYTHON_PROBE_SOURCE,
      encoding:'utf8',shell:false,windowsHide:true,timeout:5000,maxBuffer:2048})
    if(result?.error||result?.status!==0)return {ok:false,reason:'runtime_execution_failed'}
    const match=/^VISION_PYTHON_CHECK:(\{[^\r\n]{1,300}\})$/m.exec(String(result?.stdout||''))
    if(!match)return {ok:false,reason:'invalid_probe_receipt'}
    const receipt=JSON.parse(match[1]);const version=receipt?.version
    if(!Array.isArray(version)||version[0]!==3||version[1]<10||version[1]>13)return {ok:false,reason:'unsupported_python_version'}
    if(receipt.ok!==true){
      const stage=['temp','duty_home'].includes(receipt.stage)?receipt.stage:'unknown'
      return {ok:false,reason:'runtime_permission_error',stage}
    }
    if(requiresMcp&&receipt.deps!==true){
      const missingModules=Array.isArray(receipt.missingModules)
        ?receipt.missingModules.filter(m=>REQUIRED_MODULES.includes(m)).slice(0,4):[]
      return {ok:false,reason:'missing_mcp_dependencies',missingModules}
    }
    return {ok:true,reason:'healthy'}
  }catch{return {ok:false,reason:'runtime_execution_failed'}}
}

export function selectVisionPython({preferred='',configured='',home='',workdir='',env=process.env,
  platform=process.platform,requiresMcp=true,execute=spawnSync}={}){
  let firstFailure=null
  const checks=[]
  const candidates=visionPythonCandidates({preferred,configured,home,workdir,env,platform})
  for(let i=0;i<candidates.length;i++){
    const result=probeVisionPython(candidates[i],{home,env,requiresMcp,execute})
    if(result.ok)return {ok:true,path:candidates[i],source:i===0?'configured':'fallback',reason:'healthy'}
    if(!firstFailure)firstFailure=result
    // No executable path, raw errors or user data appears in the diagnostics.
    checks.push({source:i===0?'first_candidate':'fallback',reason:result.reason,stage:result.stage||''})
  }
  return {ok:false,path:'',source:'none',reason:firstFailure?.reason||'missing_runtime',
    ...(firstFailure?.stage?{stage:firstFailure.stage}:{}),
    ...(firstFailure?.missingModules?{missingModules:firstFailure.missingModules}:{}),
    candidatesChecked:candidates.length,checks}
}
