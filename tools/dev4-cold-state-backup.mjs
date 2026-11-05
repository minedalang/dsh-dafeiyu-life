#!/usr/bin/env node
/** Run only with DSH Desktop stopped. Snapshot includes credentials and secrets. */
import {createColdSnapshot,restoreColdSnapshot,verifyColdSnapshot} from '../lib/cold-state-snapshot.mjs'
const [command,...argv]=process.argv.slice(2)
const get=flag=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:null}
try{
  let result
  if(command==='backup')result=createColdSnapshot({root:get('--root'),destination:get('--to'),stoppedConfirmed:argv.includes('--stopped')})
  else if(command==='verify')result=verifyColdSnapshot(get('--snapshot'))
  else if(command==='restore')result=restoreColdSnapshot({snapshot:get('--snapshot'),root:get('--root'),
    stoppedConfirmed:argv.includes('--stopped'),confirm:get('--confirm')})
  else throw Error('用法：backup --root 路径 --to 备份目录 --stopped | verify --snapshot 目录 | restore --snapshot 目录 --root 路径 --stopped --confirm RESTORE_FULL_DSH_STATE')
  // Do not print private file names or content in normal output.
  console.log(JSON.stringify(result))
}catch(e){console.error('操作未完成：'+String(e?.message||e));process.exitCode=1}
