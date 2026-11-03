import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {recentComments} from '../lib/recent-comments.mjs'
import {recordConfirmedRecipient} from '../lib/confirmed-comment-recipients.mjs'

const A='BV17x411w7KC', B='BV1mzso6uEZh', OUT='322430862001', ROOT='322430844288'
const fixture=()=>mkdtempSync(join(tmpdir(),'v262-public-reply-identity-'))
const rows=(dir,lines)=>writeFileSync(join(dir,'seen.md'),'## 评论记录\n'+lines.join('\n')+'\n')
const modern=(bv=A,uid='485221842',name='鲸鱼娘阿鱼',out=OUT)=>`| ${bv} | ${out} | ${ROOT} | 2026-11-03 16:00:00 | 鱼鱼回了这条 | recipient_uid=${uid} | recipient_name=${name} | recipient_comment=是我说的蓝色 |`

test('底层 MCP 成功回执附带身份时，没有普通评论 Agent 旁路索引也显示 UID、昵称和原评论',()=>{
 const dir=fixture();try{
  rows(dir,[modern()]);const row=recentComments(dir).rows[0]
  assert.equal(row.recipientUid,'485221842')
  assert.equal(row.recipientName,'鲸鱼娘阿鱼')
  assert.equal(row.recipientComment,'是我说的蓝色')
  assert.equal(row.snippet,'鱼鱼回了这条')
  assert.equal(row.recipientIdentitySource,'发送回执·平台核验接收人')
  assert.equal(recentComments(dir).counts.unknownRecipientUid,0)
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('回执身份只与同 BV + 实际发出 rpid 对应，不能匹配相同楼层或其他视频',()=>{
 const dir=fixture();try{
  rows(dir,[modern(),`| ${B} | ${OUT} | ${ROOT} | 2026-11-03 15:00:00 | 另一个视频的回复 |`,
    `| ${A} | 322430862002 | ${ROOT} | 2026-11-03 14:00:00 | 同楼层另一条 |`])
  const res=recentComments(dir)
  assert.equal(res.total,3)
  assert.equal(res.rows.find(x=>x.bvid===B).recipientUid,'')
  assert.equal(res.rows.find(x=>x.rpid==='322430862002').recipientUid,'')
  assert.equal(res.rows.find(x=>x.bvid===A&&x.rpid===OUT).recipientUid,'485221842')
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('已核实的平台接收人与旧 Agent UID 冲突时隐藏身份，不能任意相信一方',()=>{
 const dir=fixture();try{
  rows(dir,[modern()]);recordConfirmedRecipient(dir,{bvid:A,rpid:OUT,uid:'210228238',name:'不属于这个接收者'})
  const row=recentComments(dir).rows[0]
  assert.equal(row.recipientIdentityStatus,'conflict')
  assert.equal(row.recipientUid,'')
  assert.equal(row.recipientName,'')
  assert.equal(recentComments(dir).counts.identityConflicts,1)
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('老版五列回执不臆造用户；确认的 JS 索引仍可以补充身份',()=>{
 const dir=fixture();try{
  rows(dir,[`| ${A} | ${OUT} | ${ROOT} | 2026-11-03 15:00:00 | 老版成功回执 |`])
  assert.equal(recentComments(dir).rows[0].recipientUid,'')
  recordConfirmedRecipient(dir,{bvid:A,rpid:OUT,uid:'210228238',name:'主人'})
  assert.equal(recentComments(dir).rows[0].recipientName,'主人')
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('遭到重复归档且宣称不同 UID 的回执绝不暴露任何一方身份',()=>{
 const dir=fixture();try{
  rows(dir,[modern(),modern(A,'210228238','另一个人')])
  const row=recentComments(dir).rows[0]
  assert.equal(row.recipientIdentityStatus,'conflict')
  assert.equal(row.recipientUid,'')
  assert.equal(row.recipientName,'')
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('账号迁移后的收件人数据在账号 runtime，旧 seen.md 在根目录：管理页仍正确关联',()=>{
 const dir=fixture();try{
  const runtime=join(dir,'accounts','485221842','runtime')
  mkdirSync(runtime,{recursive:true})
  rows(dir,[`| ${A} | ${OUT} | ${ROOT} | 2026-11-03 15:00:00 | 原有评论 |`])
  recordConfirmedRecipient(runtime,{bvid:A,rpid:OUT,uid:'210228238',name:'某个好友',comment:'你喜欢什么'})
  assert.equal(recentComments(dir).rows[0].recipientUid,'','旧接口不应自动扫描所有账号目录')
  const row=recentComments(dir,{recipientMetadataDir:runtime}).rows[0]
  assert.equal(row.recipientUid,'210228238')
  assert.equal(row.recipientName,'某个好友')
  assert.equal(row.recipientComment,'你喜欢什么')
  assert.equal(recentComments(dir,{recipientMetadataDir:join(dir,'accounts','other','runtime')}).rows[0].recipientUid,'')
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('真实管理接口显式传入当前账号 runtime，避免退回只读根目录',async()=>{
 const {readFileSync}=await import('node:fs')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const handler=index.slice(index.indexOf("path === '/api/bili-duty/recent-comments'"),
   index.indexOf('    // 「看今天的报告」'))
 assert.match(handler,/recipientMetadataDir:\s*accountRuntimeDir/)
 assert.match(index,/getComments: \(opt\) => recentComments\(stateDir,\{\.\.\.opt,recipientMetadataDir:accountRuntimeDir\}\)/)
})
