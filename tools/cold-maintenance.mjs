#!/usr/bin/env node
/** Offline, local and unencrypted. Never submit these snapshots to AI or B站. */
import {runColdMaintenance} from '../lib/cold-maintenance.mjs'
const [command,...argv]=process.argv.slice(2)
const flags=new Map([['--root','root'],['--to','destination'],['--snapshot','snapshot'],['--confirm','confirm'],['--stopped','stoppedConfirmed']])
try{
  const args={}
  for(let i=0;i<argv.length;i++){
    const key=flags.get(argv[i]);if(!key||Object.hasOwn(args,key))throw Error('未知或重复参数')
    if(key==='stoppedConfirmed'){args[key]=true;continue}
    if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('缺少参数值')
    args[key]=argv[++i]
  }
  console.log(JSON.stringify(runColdMaintenance(command,args)))
}catch(error){console.error('停机维护未完成：'+String(error?.message||error));process.exitCode=1}
