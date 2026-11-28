#!/usr/bin/env node
/** Explicit local maintenance. Never start DSH from a rescue directory. */
import {inspectPortableRescueSource,createPortableRescue,verifyPortableRescue} from '../lib/portable-backup-rescue.mjs'
const [command,...args]=process.argv.slice(2)
const get=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]}
try{
 let result
 if(command==='inspect')result=inspectPortableRescueSource(get('--source'))
 else if(command==='extract')result=createPortableRescue({source:get('--source'),destination:get('--to'),liveRoot:get('--root'),confirm:get('--confirm')})
 else if(command==='verify')result=verifyPortableRescue(get('--to'))
 else throw Error('inspect --source 备份文件 | extract --source 备份文件 --root 现役数据目录 --to 新隔离目录 --confirm EXTRACT_PORTABLE_BACKUP_OFFLINE_ONLY | verify --to 隔离目录')
 console.log(JSON.stringify(result))
}catch(error){console.error('隔离救援未完成：'+String(error?.message||error));process.exitCode=1}
