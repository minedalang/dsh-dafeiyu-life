#!/usr/bin/env node
/** Detached, one-shot fail-closed worker. The UI never deletes while DSH runs. */
import {runQueuedCleanup} from '../lib/storage-cleanup-queue.mjs'
const args=process.argv.slice(2),value=name=>args.includes(name)?args[args.indexOf(name)+1]:''
const pid=Number(value('--parent-pid'))
try{
 if(!value('--root')||!value('--job-id')||!Number.isSafeInteger(pid))throw Error('缺少任务参数')
 const result=await runQueuedCleanup({root:value('--root'),parentPid:pid,jobId:value('--job-id')})
 if(!result.ok)process.exitCode=1
}catch(e){console.error('离线旧模型清理被拒绝：'+String(e?.message||e));process.exitCode=1}
