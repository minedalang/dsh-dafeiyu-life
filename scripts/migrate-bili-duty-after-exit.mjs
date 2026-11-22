#!/usr/bin/env node
/** Detached one-shot worker. Never infer shutdown merely from a UI click. */
import {runQueuedMigration} from '../lib/storage-migration-queue.mjs'
const argv=process.argv.slice(2),arg=key=>argv.includes(key)?argv[argv.indexOf(key)+1]:''
const pid=Number(arg('--parent-pid'))
try{
 if(!arg('--root')||!arg('--job-id')||!Number.isSafeInteger(pid))throw Error('缺少停机迁移任务凭据')
 const result=await runQueuedMigration({root:arg('--root'),parentPid:pid,jobId:arg('--job-id')})
 if(!result.ok)process.exitCode=1
}catch(error){console.error('离线迁移助手拒绝执行：'+String(error?.message||error));process.exitCode=1}
