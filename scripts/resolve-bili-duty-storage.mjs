#!/usr/bin/env node
/** Read-only path resolution used by offline Windows repair scripts.
 * No data is created, no layout or permissions are modified.
 */
import {storageDataPath} from '../lib/storage-layout.mjs'
const args=process.argv.slice(2)
const flag=n=>{const i=args.indexOf(n);return i<0?'':args[i+1]||''}
const allowed=new Set(['.venv','.venv-asr','.vision-venv','uv-cache','uv-tools','uv-python'])
try{
 const root=flag('--root'),item=flag('--item')
 if(!root||!allowed.has(item))throw Error('用法：node scripts/resolve-bili-duty-storage.mjs --root <当前bili-duty> --item <.venv|.venv-asr|.vision-venv|uv-cache|uv-tools|uv-python>')
 console.log(storageDataPath(root,item))
}catch(e){console.error('安全路径解析失败：'+String(e?.message||e));process.exitCode=1}
