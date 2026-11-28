// Persist only previously requested fixed-model preparation, never acceptance or inference.
import {createHash,randomBytes} from 'node:crypto'
import {lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {withDurableFileLock} from './durable-file-lock.mjs'
import {validateLocalDataPath} from './storage-location.mjs'

export function createModelPreparationIntent({dataDir,scope,assertStorage=()=>{}}){
  if(scope===undefined)return null
  const file=kind=>{if(!['embedding','vision'].includes(kind))throw Error('未知模型准备类型');return join(dataDir,`model-preparation-${kind}.json`)}
  function identity(){
    assertStorage();validateLocalDataPath(dataDir)
    const st=lstatSync(dataDir,{bigint:true})
    if(!st.isDirectory()||st.isSymbolicLink()||st.ino===0n)throw Error('无法确认模型准备记录的本地目录身份')
    return createHash('sha256').update(JSON.stringify([scope,String(st.dev),String(st.ino),String(st.birthtimeNs)])).digest('hex')
  }
  function read(kind){
    try{const st=lstatSync(file(kind));if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('不安全的模型准备记录');return JSON.parse(readFileSync(file(kind),'utf8'))}
    catch(e){if(e.code==='ENOENT')return null;throw e}
  }
  function alive(pid){
    if(pid===null)return false
    if(!Number.isSafeInteger(pid)||pid<=0)return true
    try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}
  }
  function write(kind,row){
    const temp=file(kind)+'.'+randomBytes(12).toString('hex')+'.tmp'
    try{writeFileSync(temp,JSON.stringify(row),{flag:'wx',mode:0o600,flush:true});renameSync(temp,file(kind))}finally{try{unlinkSync(temp)}catch{}}
  }
  function transaction(kind,fn){const scope=identity();return withDurableFileLock(file(kind)+'.lock',()=>fn(read(kind),scope))}
  const matches=(row,scope)=>row?.version===1&&row.scope===scope&&typeof row.model==='string'&&/^[a-f0-9]{32}$/.test(row.token||'')
  return {
    pending(kind){return transaction(kind,(row,scope)=>matches(row,scope)&&row.cancelled!==true&&!alive(row.pid)?row.model:null)},
    claim(kind,model,{resume=false}={}){return transaction(kind,(row,scope)=>{
      if(row&&alive(row.pid))throw Error('另一进程仍持有本地模型准备记录')
      if(resume&&(!matches(row,scope)||row.cancelled===true||row.model!==model))throw Error('模型准备记录已变化')
      const token=randomBytes(16).toString('hex');write(kind,{version:1,scope,model,token,pid:process.pid});return token
    })},
    finish(kind,token,preserve){return transaction(kind,(row,scope)=>{
      if(!matches(row,scope)||row.token!==token)return
      if(preserve&&row.cancelled!==true)write(kind,{...row,pid:null});else unlinkSync(file(kind))
    })},
    cancelActive(kind,token){return transaction(kind,(row,scope)=>{if(matches(row,scope)&&row.token===token)write(kind,{...row,cancelled:true})})},
    cancelPending(kind,model){return transaction(kind,(row,scope)=>{
      if(!matches(row,scope)||alive(row.pid)||model&&row.model!==model)return false
      unlinkSync(file(kind));return true
    })}
  }
}
