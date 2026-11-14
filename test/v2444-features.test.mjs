import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync, existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {deflateSync} from 'node:zlib'
import {apply} from './helpers/ready-host.mjs'
import {proposeGrowth,updateGrowthSuggestion,reviewGrowth,updateGrowthPerson,buildGrowthContext, listGrowth} from '../lib/persona-growth.mjs'

const png=(w=32,h=32)=>{
  const crc32=buf=>{let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
  const chunk=(type,data)=>{const bytes=Buffer.from(type);const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([bytes,data])));return Buffer.concat([length,bytes,data,crc])}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  const rows=Buffer.concat(Array.from({length:h},()=>Buffer.concat([Buffer.from([0]),Buffer.alloc(w*3,120)])))
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ih),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])
}
const home=()=>mkdtempSync(join(tmpdir(),'dsh-v2444-'))
const apiSetup=(base)=>{
 let route
 apply({get(k){return k==='dshHomePath'?(...parts)=>join(base,...parts):undefined},logger:{info(){},warn(){}},tools:{register(){}},
   webServer:{register(spec){route=spec;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{})
 return async(method,path,body)=>{
   const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url=path;req.headers={host:'localhost'}
   let code,result,headers;const res={writeHead(c,h){code=c;headers=h},end(data){try{result=JSON.parse(data)}catch{result=data}}}
   await route.handler(req,res);return {code,result,headers}
 }
}

test('新版不能新建关系成长规则，旧版关系仍由统一人生记忆检索负责',()=>{
 const dir=home();try{
   assert.throws(()=>proposeGrowth(dir,{type:'relationship',text:'Claude 是大肥鱼在虚构世界里的朋友，交流很自然'}),/人生记忆/)
   assert.equal(buildGrowthContext(dir,{scene:'video',query:'克劳德'}),'')
   const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
   assert.match(html,/人物关系与旧资料/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('梗知识库人工新增通过 API 实际写入 SQLite，重名失败',async()=>{
 const dir=home();try{
   const call=apiSetup(dir)
   const obj={name:'手动记录的梗',aliases:'人工知识',meaning:'主人亲自录入的一个视频互动梗，适合玩笑',kind:'梗',confidence:'待核实'}
   const first=await call('POST','/api/bili-duty/meme-memory/add',obj)
   assert.equal(first.code,200,JSON.stringify(first.result));assert.equal(first.result.status,'approved')
   const list=await call('GET','/api/bili-duty/meme-memory?q=手动记录')
   assert.equal(list.result.entries[0].review_status,'approved')
   const dup=await call('POST','/api/bili-duty/meme-memory/add',obj)
   assert.equal(dup.code,400)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('表情包上传、预览、改名和删除；扩展名伪装、路径穿越和同名冲突被拒绝',async()=>{
 const dir=home();try{
   const call=apiSetup(dir)
   const image=png();const body={name:'开心/大笑',ext:'.png',data:image.toString('base64')}
   const uploaded=await call('POST','/api/bili-duty/stickers?action=upload',body)
   assert.equal(uploaded.code,200,JSON.stringify(uploaded.result))
   assert.ok(existsSync(join(dir,'bili-duty','comment-memes','开心','大笑.png')))
   const list=await call('GET','/api/bili-duty/stickers')
   assert.equal(list.code,200);assert.equal(list.result.total,1)
   const preview=await call('GET','/api/bili-duty/stickers/file?name='+encodeURIComponent('开心/大笑'))
   assert.equal(preview.code,200);assert.equal(preview.headers['content-type'],'image/png')
   assert.ok(Buffer.isBuffer(preview.result))
   const bad=await call('POST','/api/bili-duty/stickers?action=upload',{...body,name:'坏文件',data:Buffer.from('GIF89a').toString('base64')})
   assert.equal(bad.code,400)
   const traversal=await call('POST','/api/bili-duty/stickers?action=upload',{...body,name:'../外部'})
   assert.equal(traversal.code,400)
   const dupe=await call('POST','/api/bili-duty/stickers?action=upload',{...body,name:'开心/大笑'})
   assert.equal(dupe.code,400)
   const renamed=await call('POST','/api/bili-duty/stickers?action=rename',{name:'开心/大笑',newName:'开心/开心鲸鱼'})
   assert.equal(renamed.code,200,JSON.stringify(renamed.result))
   const library=await call('GET','/api/bili-duty/comment-memes')
   assert.deepEqual(library.result.names,['开心/开心鲸鱼'])
   const deleted=await call('POST','/api/bili-duty/stickers?action=delete',{name:'开心/开心鲸鱼'})
   assert.equal(deleted.code,200)
   const after=await call('GET','/api/bili-duty/stickers')
   assert.equal(after.result.total,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('管理页提供四类入口，已批准成长经验才需要删除确认',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(js,/e.status==='approved'&&\!await confirmAction/)
 for(const name of ['growth-list','meme-new-save','sticker-upload','sticker-list','sticker-search'])assert.ok(html.includes('id="'+name+'"'))
 assert.ok(html.includes('data-tab="stickers"'))
 assert.ok(html.includes('自己编写，直接待审核'))
})
