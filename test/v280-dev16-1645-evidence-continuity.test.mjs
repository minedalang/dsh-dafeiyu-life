import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {continuationPrompt,parseContinuationDecision} from '../lib/life-continuation.mjs'
const id='a'.repeat(24),bv='BV1aBcD2eF3G'
const menu=[{action:'inspect_creator_space',id},{action:'comment_video',id,bvid:bv},{action:'inspect_video_discussion',id,bvid:bv}]
test('same-BV verified discussion evidence is presented as untrusted public context',()=>{
 const prompt=continuationPrompt(menu,'',{ok:true,bvid:bv,title:'真实视频标题',description:'公开描述',comments:['评论区的一条公开观点'],recentVerifiedReadYield:{kind:'discussion',novel:true,observations:1}})
 assert.match(prompt,/评论区的一条公开观点/)
 assert.match(prompt,/其他人公开发言/)
 assert.match(prompt,/信息增量/)
})
test('metadata-only comment eligibility is described without claiming full viewing',()=>{
 const prompt=continuationPrompt(menu,'',{ok:true,bvid:bv,title:'标题',description:'',comments:[]})
 assert.match(prompt,/只有公开元数据/)
 assert.match(prompt,/保持沉默/)
})
test('empty schema placeholders do not manufacture unexpected-target; nonempty wrong target still rejected',()=>{
 assert.deepEqual(parseContinuationDecision(JSON.stringify({action:'inspect_creator_space',id,bvid:'',text:'',folderTitle:'',personId:'',reason:'想看看作者'}),menu),
  {action:'inspect_creator_space',id,reason:'想看看作者'})
 assert.equal(parseContinuationDecision(JSON.stringify({action:'inspect_creator_space',id,bvid:bv,reason:'想看看作者'}),menu).reason,'unexpected-target')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'comment_video',id,bvid:bv,text:'',reason:'确实很想评论这条作品'}),menu).reason,'unsafe-comment')
})
test('verified public discussion is ephemeral and bound to current account and BV',()=>{
 const s=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 assert.match(s,/discussionEvidenceCache\?\.account===scope/)
 assert.match(s,/discussionEvidenceCache\.bvid===writeEvidence\.bvid/)
 assert.match(s,/now\(\)-discussionEvidenceCache\.at<600_000/)
 assert.match(s,/discussion\.verified!==true/)
 assert.match(s,/discussionEvidenceCache=\{account:scope,bvid:selected/)
})
