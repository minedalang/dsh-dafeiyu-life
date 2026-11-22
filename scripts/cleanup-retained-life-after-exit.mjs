#!/usr/bin/env node
/** Detached one-shot worker. Never run this with the DSH plugin still active. */
import {runQueuedLifeCleanup} from '../lib/storage-life-cleanup-queue.mjs'
const args=process.argv.slice(2),val=key=>args.includes(key)?args[args.indexOf(key)+1]:''
const parentPid=Number(val('--parent-pid'))
try{
 if(!val('--root')||!val('--job-id')||!Number.isSafeInteger(parentPid))throw Error('缺少有效的清理任务参数')
 const result=await runQueuedLifeCleanup({root:val('--root'),parentPid,jobId:val('--job-id')})
 if(!result.ok)process.exitCode=1
}catch(error){console.error('Life 停机清理被拒绝：'+String(error?.message||error));process.exitCode=1}
