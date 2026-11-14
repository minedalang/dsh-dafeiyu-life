import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {verifiedBiliImageUrl,extractBiliPictures} from '../lib/incoming-image-vision.mjs'
import {normalizeReplyNotifications,normalizeTopComments} from '../lib/comment-inbox.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const BV='BV1EWxd6sExz',P0='https://i0.hdslb.com/bfs/new/a.png',P1='https://i1.hdslb.com/bfs/new/b.jpg'

test('the Life action tree and responsive two-column diary are one permanently visible area',()=>{
 const page=html.slice(html.indexOf('<section id="panel-life-agent"'),html.indexOf('<div id="life-now-recent"'))
 assert.ok(page.indexOf('id="life-behavior-tree"')<page.indexOf('id="life-timeline-list"'))
 assert.ok(!page.includes('📅 大肥鱼的一天'))
 assert.doesNotMatch(page,/<details class="life-now-timeline|点击收起或展开/)
 assert.match(html,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(html,/@media\(max-width:760px\).*grid-template-columns:1fr/)
 assert.match(html,/prefers-reduced-motion:reduce/)
 assert.match(js,/typeof setInterval==='function'\?setInterval\(\(\)=>\{void reconcileVisibleLife\(\)\},4000\)/)
 assert.match(js,/document\.hidden\|\|active!=='life-agent'/)
 assert.match(js,/lifeTimelineKnownIds/)
 assert.match(js,/lastLifeTreeFingerprint/)
 assert.match(js,/lifeTimelineFingerprint=''/)
})

test('03 begins with strongly recommended semantic memory and 04 has the requested session copy',()=>{
 const first=html.indexOf('id="quick-embedding-section"'),third=html.indexOf('<h3>03 · ')
 assert.ok(first>third)
 assert.ok(first<html.indexOf('id="quick-life-section"'))
 assert.match(html,/强烈推荐 · 可选/)
 assert.match(html,/不开启时仍可用词法回忆，但换一种说法/)
 assert.match(html,/绑定与鱼鱼交谈的session会话；以后可以在管理中心随时修改。/)
})

test('verified B站 comment pictures preserve up to three independent images without external URLs',()=>{
 assert.equal(verifiedBiliImageUrl('https://evil.com/a.png'),'')
 assert.equal(verifiedBiliImageUrl('https://i0.hdslb.com/bfs/new/a.png?redirect=1'),P0)
 const content={content:{message:'这是谁呀',pictures:[{img_src:P0},{img_src:P1},{img_src:P0},
   {img_src:'https://example.com/bfs/not-valid.png'}]}}
 assert.deepEqual(extractBiliPictures(content),[P0,P1])
 const top=normalizeTopComments({comments:[{mid:'300',rpid:'123456789',content:content.content,ctime:1794622489}]},BV,'200')
 assert.equal(top.length,1)
 assert.deepEqual(top[0].imageUrls,[P0,P1])
 assert.equal(top[0].text,'这是谁呀')
 const notices=normalizeReplyNotifications({items:[{user:{mid:'300',uname:'评论用户'},item:{subject_id:'1',source_id:'234567890',
   uri:'https://www.bilibili.com/video/'+BV,source_content:'这是两张图',pictures:content.content.pictures,
   timestamp:1794622489}}]},'200')
 assert.equal(notices.length,1)
 assert.deepEqual(notices[0].imageUrls,[P0,P1])
 const wrapped=normalizeReplyNotifications({items:[{user:{mid:'300',uname:'评论用户'},item:{subject_id:'1',source_id:'234567891',
   uri:'https://www.bilibili.com/video/'+BV,source_content:{message:'你看回放里的龙龙',pictures:content.content.pictures},
   timestamp:1794622489}}]},'200')
 assert.equal(wrapped[0].text,'你看回放里的龙龙')
 assert.deepEqual(wrapped[0].imageUrls,[P0,P1])
 assert.match(index,/imageUrls:\[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(row\.imageUrls\)/)
 assert.match(index,/const visualReq=await addIncomingPictureObservation\(req\)/)
 assert.match(index,/const visualRow=await addIncomingPictureObservation/)
})

test('a top-level verified comment is visibly distinguished from a reply but no cause is fabricated',()=>{
 const t=Date.parse('2026-11-14T02:14:49Z')
 const entries=buildLifeTimeline({now:t+20000,days:1,comments:[{time:new Date(t).toISOString(),bvid:BV,rpid:'323892167808',kind:'top',snippet:'我觉得这种反差挺带劲'}]})
 const row=entries.find(x=>x.type==='comment')
 assert.equal(row.label,'发表原创主评论')
 assert.match(row.detail,/不是对旧楼层的回复/)
 assert.match(row.detail,/单条公开评论回执没有完整的触发原因/)
 assert.equal(row.bvid,BV)
})

test('friend public relationship and memory evidence are per-UID and retrievable on demand',async()=>{
 const seen=[]
 const policy={actor:uid=>({role:uid==='300'?'friend':'unverified'}),canViewRelationship:()=>true,
   canViewIdentity:()=>true,memoryScope:()=> 'public-social'}
 const assembler=createSocialContextAssembler({policy,
  memoryRetriever:{socialContextAsync:async(search,opt)=>{seen.push({search,opt});return '【公开共同经历】曾经聊过小龙的视频'}},
  getRelationship:uid=>uid==='300'?'好友关系：曾在评论中交流过':'',
  getIdentity:()=> '当前 UID 已核实',
  getPrivateLifeContext:async()=>'',
 })
 const first=await assembler.message({uid:'300',kind:'comment',bvid:BV,text:'龙龙这是不是你呀可爱的小笨龙'},{mode:'compact'})
 assert.match(first.relationshipContext,/好友关系/)
 assert.equal(first.memoryContext,'')
 assert.ok(first.availableContexts.includes('memory'))
 const second=await assembler.message({uid:'300',kind:'comment',bvid:BV,text:'我们之前聊过小龙吗？',recallQueries:['小龙的视频']},
   {mode:'compact',requested:['memory']})
 assert.match(second.memoryContext,/曾经聊过小龙的视频/)
 assert.equal(seen.length,1)
 assert.equal(seen[0].opt.actorUid,'300')
 assert.equal(seen[0].opt.currentBvid,BV)
})

test('comment model is directed to resolve the referent from the actual video instead of self-identification',async()=>{
 const prompts=[]
 const batch=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',
   invoke:async prompt=>{prompts.push(prompt);return JSON.stringify({items:[{id:'0',action:'reply',messages:['这只小龙在画面里真可爱呀！'],mood:'warm',intensity:1}]})}})
 try{
   const response=await batch.generate({kind:'comment',uid:'300',text:'龙龙这是不是你呀可爱的小笨龙',
     bvid:BV,context:'视频内容：回放中出现一只龙龙。',socialAutonomy:false})
   assert.ok(typeof response==='string' ? response.includes('小龙') : response.action==='reply')
   assert.match(prompts[0],/不天然指鱼鱼/)
   assert.match(prompts[0],/不要答“不是我”/)
   assert.match(prompts[0],/龙龙这是不是你呀可爱的小笨龙/)
 }finally{batch.stop()}
})
