/**
 * Windows vision Python selection, with an actual unprivileged write probe.
 * No ACL edits, administrative elevation, shell, network or configuration output.
 * A Python that merely exists / imports packages is NOT considered healthy.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, lstatSync} from 'node:fs'
import {isAbsolute, join, parse, resolve} from 'node:path'

const CHECK = `import sys,os,tempfile,uuid,pathlib,json,importlib.util\n`+
`out={'ok':False,'version':sys.version_info[:2],'deps':False}\n`+
`try:\n`+
`  for root in (os.environ.get('TEMP') or tempfile.gettempdir(),os.getcwd()):\n`+
`    p=pathlib.Path(root)/('dsh-vision-health-'+uuid.uuid4().hex+'.tmp')\n`+
`    try:\n`+
`      p.write_bytes(b'1')\n`+
`    finally:\n`+
`      p.unlink(missing_ok=True)\n`+
`  out['ok']=True\n`+
`except OSError: pass\n`+
`try:\n`+
`  out['deps']=all(importlib.util.find_spec(m) is not None for m in ('mcp','bilibili_api','qrcode','PIL'))\n`+
`except (ImportError,ValueError,AttributeError): pass\n`+
`print('VISION_PYTHON_CHECK:'+json.dumps(out,separators=(',',':')))\n`

const safePath=(path)=>{
  const p=String(path||'').trim()
  if(!p||!isAbsolute(p)||!p.toLowerCase().endsWith('python.exe'))return ''
  try{if(!existsSync(p)||lstatSync(p).isSymbolicLink()||!lstatSync(p).isFile())return ''}catch{return ''}
  return p
}

export function visionPythonCandidates({preferred='',configured='',home='',workdir='',env=process.env,platform=process.platform}={}){
  const raw=[preferred,configured,env.BILI_DUTY_VISION_PYTHON]
  if(platform==='win32'){
    const drives=new Set([parse(String(workdir||'')).root,parse(String(home||'')).root])
    for(const root of drives)if(root){raw.push(join(root,'Anaconda3','python.exe'),join(root,'miniconda3','python.exe'))}
    for(const prefix of [env.CONDA_PREFIX,env.USERPROFILE])if(prefix){
      raw.push(join(prefix,'python.exe'),join(prefix,'Anaconda3','python.exe'),join(prefix,'miniconda3','python.exe'))
    }
  }
  const seen=new Set()
  return raw.map(safePath).filter(p=>{if(!p)return false;const key=resolve(p).toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,8)
}

export function probeVisionPython(python,{home='',env=process.env,requiresMcp=true,execute=spawnSync}={}){
  const p=safePath(python)
  if(!p||!home||!isAbsolute(home))return {ok:false,reason:'missing_runtime'}
  // Run normal interpreter, not -S: installed MCP dependencies must be visible.
  // No arbitrary user input is executed in Python. Output is a strict marker only.
  try{
    const result=execute(p,['-I','-'],{cwd:home,env:{...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},input:CHECK,
      encoding:'utf8',shell:false,windowsHide:true,timeout:5000,maxBuffer:2048})
    if(result?.error||result?.status!==0)return {ok:false,reason:'runtime_execution_failed'}
    const match=/^VISION_PYTHON_CHECK:(\{[^\r\n]{1,200}\})$/m.exec(String(result?.stdout||''))
    if(!match)return {ok:false,reason:'invalid_probe_receipt'}
    const receipt=JSON.parse(match[1]);const version=receipt?.version
    if(!Array.isArray(version)||version[0]!==3||version[1]<10||version[1]>13)return {ok:false,reason:'unsupported_python_version'}
    if(receipt.ok!==true)return {ok:false,reason:'runtime_permission_error'}
    if(requiresMcp&&receipt.deps!==true)return {ok:false,reason:'missing_mcp_dependencies'}
    return {ok:true,reason:'healthy'}
  }catch{return {ok:false,reason:'runtime_execution_failed'}}
}

export function selectVisionPython({preferred='',configured='',home='',workdir='',env=process.env,
  platform=process.platform,requiresMcp=true,execute=spawnSync}={}){
  let last='missing_runtime'
  const candidates=visionPythonCandidates({preferred,configured,home,workdir,env,platform})
  for(let i=0;i<candidates.length;i++){
    const result=probeVisionPython(candidates[i],{home,env,requiresMcp,execute})
    if(result.ok)return {ok:true,path:candidates[i],source:i===0?'configured':'fallback',reason:'healthy'}
    if(i===0||last==='missing_runtime')last=result.reason
  }
  return {ok:false,path:'',source:'none',reason:last,candidatesChecked:candidates.length}
}
