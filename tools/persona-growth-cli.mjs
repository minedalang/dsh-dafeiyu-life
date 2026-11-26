#!/usr/bin/env node
/** 在插件仓库根目录执行：node tools/persona-growth-cli.mjs list|add|approve|reject|delete|undo|sync|context */
import {assertCheckpointClear} from '../lib/cold-restore-fence.mjs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {readFileSync} from 'node:fs'
import {listGrowth,proposeGrowth,reviewGrowth,deleteGrowth,undoGrowth,syncReportsToGrowth,buildGrowthContext} from '../lib/persona-growth.mjs'
const dir=process.env.BILI_DUTY_HOME||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'bili-duty')
const [command,...args]=process.argv.slice(2)
try{
 assertCheckpointClear(dir)
 let out
 switch(command){
  case 'list': out=listGrowth(dir,{status:args[0]||''});break
  case 'add': out=proposeGrowth(dir,{type:args[0]||'style',text:args.slice(1).join(' ')});break
  case 'approve':out=reviewGrowth(dir,args[0],'approved');break
  case 'reject':out=reviewGrowth(dir,args[0],'rejected');break
  case 'delete':out=deleteGrowth(dir,args[0]);break
  case 'undo':out=undoGrowth(dir);break
  case 'sync':out=syncReportsToGrowth(dir,{limit:15});break
  case 'context':out={text:buildGrowthContext(dir,{query:args.join(' ')})};break
  default:throw Error('命令：list [pending] | add <style|interest|experience|relationship> <经验> | approve <ID> | reject <ID> | delete <ID> | undo | sync | context [主题]')
 }
 console.log(JSON.stringify({ok:true,data:out,store:dir},null,2))
}catch(e){console.error('成长记忆：'+e.message);process.exitCode=1}
