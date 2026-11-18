import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'
import {plannerActionMenu,validateOfferedLifeAction} from '../lib/autonomous-planner.mjs'

const ACCOUNT='0123456789abcdef',OTHER='ffffffffffffffff',SENDER='123456789'
const ROOT='1234567890123456',ORIG='1234567890123457',BV='BV1AA411c7mD'
const opts=(op,enabled=false)=>plannerActionMenu({opportunities:op,candidates:[],cues:[],intents:[],lifeEvents:[],lifeSkills:[],lifePublicInteractionEnabled:enabled})
const withStore=fn=>{const dir=mkdtempSync(join(tmpdir(),'life-continuous-'));let account=ACCOUNT
 const store=createLifeSharedBiliLinks({stateDir:dir,getAccountTag:()=>account})
 try{return fn({store,dir,change:v=>account=v})}finally{rmSync(dir,{recursive:true,force:true})}}

const readRoot=(store,id,author='99887766')=>store.recordRead(id,{ok:true,kind:'dynamic',dynamicId:ROOT,title:'转发的文字',summary:'公开标题',authorUid:author,
 related:[{kind:'dynamic',dynamicId:ORIG,relation:'reposted-original'},
 {kind:'video',bvid:BV,relation:'embedded-video'},
 {kind:'video',bvid:'untrusted',relation:'embedded-video'},
 {kind:'dynamic',dynamicId:ROOT,relation:'reposted-original'}]},ACCOUNT)

 test('转发动态提供两个独立可信子目标，不在读取外层时自动读取原帖/视频',()=>withStore(({store})=>{
  const id=store.offerFromMessage({uid:SENDER,role:'owner',messageId:'msg-one',text:`https://t.bilibili.com/${ROOT}`}).ids[0]
  assert.equal(readRoot(store,id).ok,true)
  const rows=store.list({limit:20})
  const original=rows.find(x=>x.kind==='dynamic'&&x.source==='related-public-content')
  const video=rows.find(x=>x.kind==='video'&&x.source==='related-public-content')
  assert.equal(rows.length,3);assert.equal(original.status,'pending');assert.equal(video.status,'pending')
  assert.equal(original.parentId,id);assert.equal(video.parentId,id)
  assert.equal(store.get(original.id,ACCOUNT).ref.dynamicId,ORIG)
  assert.equal(store.get(video.id,ACCOUNT).ref.bvid,BV)
  const menu=opts(rows)
  assert.ok(menu.find(x=>x.action==='inspect_related_content').ids.includes(original.id))
  assert.ok(menu.find(x=>x.action==='inspect_related_content').ids.includes(video.id))
  assert.equal(validateOfferedLifeAction({action:'inspect_related_content',id:original.id},menu),true)
  assert.equal(validateOfferedLifeAction({action:'inspect_related_content',id:'ffffffffffffffffffffffff'},menu),false)
  assert.equal(rows.some(x=>x.title==='来自模型猜测的视频'),false)
}))

 test('深入阅读仍按两层有界深度、只记录模型明确选择且拿到平台回执的目标',()=>withStore(({store})=>{
  const id=store.offerFromMessage({uid:SENDER,role:'friend',messageId:'m1',text:`https://t.bilibili.com/${ROOT}`}).ids[0]
  readRoot(store,id)
  const orig=store.list({limit:20}).find(x=>x.source==='related-public-content'&&x.kind==='dynamic')
  assert.equal(store.recordRead(orig.id,{ok:true,kind:'dynamic',dynamicId:ORIG,title:'原动态',summary:'原文',authorUid:'99887765',
    related:[{kind:'video',bvid:'BV1AB411c7mD',relation:'embedded-video'}]},ACCOUNT).ok,true)
  const deep=store.list({limit:20}).find(x=>x.parentId===orig.id)
  assert.equal(deep.depth,2)
  assert.equal(store.recordRead(deep.id,{ok:true,kind:'video',bvid:'BV1AB411c7mD',title:'公开视频',summary:'资料而非视觉理解',
    related:[{kind:'dynamic',dynamicId:'1234567890123499',relation:'reposted-original'}]},ACCOUNT).ok,true)
  assert.equal(store.list({limit:20}).length,4)
}))

 test('主人分享的第三方原动态在明确统一授权后可以考虑互动，但不强制写入',()=>withStore(({store})=>{
  const id=store.offerFromMessage({uid:SENDER,role:'owner',messageId:'m3',text:`https://t.bilibili.com/${ROOT}`}).ids[0]
  store.recordRead(id,{ok:true,kind:'dynamic',dynamicId:ROOT,title:'转发的内容',summary:'公开正文',authorUid:'99887766',commentable:true},ACCOUNT)
  const row=store.list()[0]
  assert.equal(row.authorMatchesSharer,false)
  assert.equal(opts([row]).some(x=>x.action==='like_shared_dynamic'),false)
  const menu=opts([row],true)
  assert.equal(menu.some(x=>x.action==='like_shared_dynamic'&&x.ids.includes(id)),true)
  assert.equal(menu.some(x=>x.action==='comment_shared_dynamic'&&x.ids.includes(id)),true)
  assert.equal(validateOfferedLifeAction({action:'comment_shared_dynamic',id,reason:'我觉得这个视频很有意思',text:'这个内容角度挺特别的，很喜欢。'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'comment_shared_dynamic',id,reason:'我觉得这个视频很有意思',text:'@friend https://example.com'},menu),false)
  assert.equal(store.recordInteraction(id,'like_shared_dynamic','accepted-unverified',ACCOUNT).ok,true)
  const after=opts(store.list(),true)
  assert.equal(after.some(x=>x.action==='like_shared_dynamic'),false)
  assert.equal(after.some(x=>x.action==='comment_shared_dynamic'),true)
  assert.equal(store.recordInteraction(id,'comment_shared_dynamic','uncertain',ACCOUNT).ok,true)
  assert.equal(opts(store.list(),true).some(x=>x.action==='comment_shared_dynamic'),false)
  assert.equal(store.recordInteraction(id,'comment_shared_dynamic','verified',ACCOUNT).ok,false)
}))

 test('没有作者核验、文本证据或可评论状态，不提供公开写入',()=>withStore(({store})=>{
  const id=store.offerFromMessage({uid:SENDER,role:'owner',messageId:'m4',text:`https://t.bilibili.com/${ROOT}`}).ids[0]
  store.recordRead(id,{ok:true,kind:'dynamic',dynamicId:ROOT,title:'一个标题',summary:'',authorUid:''},ACCOUNT)
  assert.equal(opts(store.list(),true).some(x=>['like_shared_dynamic','comment_shared_dynamic'].includes(x.action)),false)
}))

 test('跨轮历史分享只在同账号同发件人下可取到；不暴露原私信、UID 或 URL',()=>withStore(({store,change})=>{
  store.offerFromMessage({uid:SENDER,role:'owner',messageId:'m5',text:`看我的动态 https://t.bilibili.com/${ROOT} private`})
  const candidates=store.recentForContact({uid:SENDER})
  assert.equal(candidates.length,1)
  assert.equal('senderUid' in candidates[0],false)
  assert.equal('text' in candidates[0],false)
  assert.equal('ref' in candidates[0],false)
  assert.equal(store.recentForContact({uid:'987654321'}).length,0)
  change(OTHER)
  assert.equal(store.recentForContact({uid:SENDER}).length,0)
  assert.equal(store.get(candidates[0].id,ACCOUNT),null)
}))

 test('旧专属开关彻底退出运行/配置/UI；新公开互动仍需要明确用户确认',()=>{
  const host=readFileSync('index.js','utf8'),planner=readFileSync('lib/autonomous-planner.mjs','utf8')
  const py=readFileSync('vendor/bilibili-mcp/mcp_server.py','utf8')
  const ui=readFileSync('lib/management-console.html','utf8')
  const old=/lifeSharedDynamicLikeEnabled|lifeSharedDynamicCommentEnabled|BILI_LIFE_SHARED_DYNAMIC_LIKE_ENABLED|BILI_LIFE_SHARED_DYNAMIC_COMMENT_ENABLED/
  for(const s of [host,planner,py,ui])assert.doesNotMatch(s,old)
  assert.match(host,/lifePublicInteractionEnabled: z\.boolean\(\)\.default\(false\)/)
  assert.match(host,/confirmPublicInteraction!=='ENABLE_LIFE_PUBLIC_INTERACTION'/)
  assert.match(ui,/id="life-public-interaction-enabled"/)
  assert.match(host,/lifeWillingness\.verify\(proof,kind,payload,\{requireSealed:true\}\)/)
})


test('首页和兴趣的已核验 BV 只生成自主可选的公开候选，去重且账号隔离',()=>withStore(({store,change})=>{
 const accepted=store.offerVerifiedPublicVideos({accountUid:SENDER,origin:'home-discovery',videos:[
   {bvid:BV,title:'真实首页卡片'}, {bvid:'not-a-bv',title:'无效'}, {bvid:BV,title:'重复标题'}]})
 assert.equal(accepted.ok,true);assert.equal(accepted.created,1)
 let publicRows=store.list({limit:20}).filter(x=>x.source==='public-discovery-content')
 assert.equal(publicRows.length,1);assert.equal(publicRows[0].status,'pending')
 assert.equal(publicRows[0].publicOrigin,'home-discovery')
 assert.equal(opts(publicRows).find(x=>x.action==='inspect_related_content').ids.includes(publicRows[0].id),true)
 assert.equal(store.offerVerifiedPublicVideos({accountUid:SENDER,origin:'interest-search',videos:[{bvid:BV,title:'相同视频'}]}).created,0)
 assert.equal(store.offerVerifiedPublicVideos({accountUid:SENDER,origin:'other',videos:[{bvid:BV,title:'非法来源'}]}).ok,false)
 change(OTHER);assert.equal(store.list().length,0)
}))

test('真实视频元数据只生成下一步作者空间机会，不自动打开，也不授予点赞评论',()=>withStore(({store})=>{
 const result=store.offerVerifiedPublicVideos({accountUid:SENDER,origin:'video-metadata',inspected:true,
   videos:[{bvid:BV,title:'真实视频标题',description:'从 B站元数据读取的简介',authorUid:'99887766'}]})
 assert.equal(result.created,1)
 const rows=store.list({limit:20})
 const video=rows.find(x=>x.source==='public-discovery-content'&&x.kind==='video')
 const author=rows.find(x=>x.source==='related-public-content'&&x.kind==='profile')
 assert.ok(video);assert.ok(author)
 assert.equal(video.status,'inspected');assert.equal(author.status,'pending')
 assert.equal(author.parentId,video.id)
 assert.equal(store.get(author.id,ACCOUNT).ref.uid,'99887766')
 assert.ok(opts(rows,true).some(x=>x.action==='inspect_related_content'&&x.ids.includes(author.id)))
 assert.ok(!opts(rows,true).some(x=>x.action==='like_shared_dynamic'))
 assert.equal(store.offerVerifiedPublicVideos({accountUid:SENDER,origin:'video-metadata',inspected:true,
   videos:[{bvid:BV,title:'重复证据',authorUid:'99887766'}]}).created,0)
}))

test('自发发现的公开视频写入与转发内容同样走通用 Life 后续菜单，没有私信内容依赖',()=>{
 const host=readFileSync('index.js','utf8')
 for(const origin of ['home-discovery','interest-search','creator-portfolio','public-person','video-metadata','commenter-portfolio'])
  assert.match(host,new RegExp("origin:'"+origin+"'"))
 assert.match(host,/offerVerifiedPublicVideos/)
 assert.match(readFileSync('lib/autonomous-planner.mjs','utf8'),/public-discovery-content/)
})


test('关联内容执行分支确实接受对应可信来源，不能只停留在模型菜单',()=>{
 const planner=readFileSync('lib/autonomous-planner.mjs','utf8')
 const branch=planner.slice(planner.indexOf("}else if(['inspect_shared_link','inspect_related_content'].includes(outcome.action))"))
 assert.match(branch,/outcome.action==='inspect_related_content'/)
 assert.match(branch,/\['related-public-content','public-discovery-content'\]/)
 assert.match(branch,/allowedSources\.includes\(x\.source\)/)
 assert.match(branch,/executeSharedBiliLinkRead\(outcome.id,accountBefore\)/)
})

test('管理中心保留放下和未知结果的只读历史，但不能再作为可执行候选',()=>withStore(({store})=>{
 const id=store.offerFromMessage({uid:SENDER,role:'owner',messageId:'historic',text:`https://t.bilibili.com/${ROOT}`}).ids[0]
 assert.equal(store.decide(id,'dismiss').ok,true)
 assert.equal(store.list().some(x=>x.id===id),false)
 const past=store.history().find(x=>x.id===id)
 assert.equal(past.status,'dismissed')
 assert.equal('senderUid' in past,false)
 assert.equal('ref' in past,false)
 assert.equal(opts(store.list()).some(x=>x.action==='inspect_shared_link'),false)
}))
