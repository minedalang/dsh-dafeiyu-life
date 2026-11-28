import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const SCOPE='0123456789abcdef',SCOPE2='1234567890abcdef',UID='202573574'
const outerId='1234567890123456',originalId='9876543210987654'
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'fish-dm-repost-'))
  let scope=SCOPE
  const store=createLifeSharedBiliLinks({stateDir:dir,getAccountTag:()=>scope})
  const offer=store.offerFromMessage({uid:UID,role:'owner',text:`https://t.bilibili.com/${outerId}`,messageId:'original-share-test'})
  return {store,id:offer.ids[0],setScope:v=>scope=v,close:()=>rmSync(dir,{recursive:true,force:true})}
}
const verifiedOuter=(related=[{relation:'reposted-original',kind:'dynamic',dynamicId:originalId}])=>({ok:true,kind:'dynamic',dynamicId:outerId,title:'转发时附言',summary:'我觉得这个值得看看',authorUid:UID,related})
const reply=(extra={})=>JSON.stringify({items:[{id:'0',action:'reply',reply:'已看完核验的原动态',messages:['已看完核验的原动态'],todoDisposition:'none',...extra}]})
const make=options=>createInteractionBatcher({delayMs:0,getPersona:()=> '鱼鱼',getContextMode:()=> 'compact',logger:{info(){},warn(){}},...options})

test('只有先读到 B站可信转发引用，且同账号同发件人，才提供唯一原动态候选',()=>{
  const f=fixture();try{
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
    assert.equal(f.store.recordRead(f.id,verifiedOuter(),SCOPE).ok,true)
    const child=f.store.repostedOriginalForParent(f.id,SCOPE)
    assert.equal(child?.relation,'reposted-original')
    assert.equal(child?.kind,'dynamic')
    assert.equal(child?.status,'pending')
    assert.notEqual(child?.id,f.id)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE2),null)
    f.setScope(SCOPE2)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
    f.setScope(SCOPE)
    const proof={ok:true,kind:'dynamic',dynamicId:originalId,title:'原帖真正内容',summary:'可核验的原帖正文',authorUid:'99887766'}
    assert.equal(f.store.recordRead(child.id,proof,SCOPE).ok,true)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE)?.status,'inspected')
  }finally{f.close()}
})

test('没有平台原帖引用时不生成阅读目标，绝不能从用户文字猜测',()=>{
  const f=fixture();try{
    f.store.recordRead(f.id,verifiedOuter([]),SCOPE)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
  }finally{f.close()}
})

test('Life 在一次私信中独立两次选择：外层读取后才可自主读取原帖，并形成最终回复',async()=>{
  const prompts=[],loads=[]
  const b=make({invoke:async prompt=>{
      prompts.push(prompt)
      if(prompts.length===1)return reply({action:'skip',reply:'',contextRequests:['shared_link']})
      if(prompts.length===2)return reply({action:'skip',reply:'',contextRequests:['shared_original']})
      return reply()
    },loadRequestedContexts:async(_batch,requests)=>{
      loads.push(requests)
      if(loads.length===1)return [{sharedLinkContext:JSON.stringify({verified:true,title:'转发附言',repostedOriginalAvailable:true,originalRead:false}),availableContexts:['shared_original']}]
      return [{sharedOriginalContext:JSON.stringify({verified:true,source:'reposted-original',title:'原帖真正内容',summary:'原动态内容证据',originalRead:true})}]
    }})
  try{
    const result=await b.generate({kind:'dm',uid:UID,text:'请看看我转发的动态',socialAutonomy:true,availableContexts:['shared_link']})
    assert.equal(result?.action,'reply')
    assert.deepEqual(result?.messages,['已看完核验的原动态'])
    assert.equal(prompts.length,3)
    assert.deepEqual(loads,[[['shared_link']],[['shared_original']]])
    assert.doesNotMatch(prompts[0],/原帖真正内容|原动态内容证据/)
    assert.match(prompts[1],/repostedOriginalAvailable/)
    assert.match(prompts[1],/read_shared_original/)
    assert.match(prompts[2],/原帖真正内容/)
  }finally{b.stop()}
})

test('Life 可选择只阅读外层、直接答复，不得自动触发原动态读取',async()=>{
  let calls=0,reads=0
  const b=make({invoke:async()=>{
      calls++
      return calls===1?reply({action:'skip',reply:'',contextRequests:['shared_link']}):reply({reply:'只知道你的转发附言，原帖还没看'})
    },loadRequestedContexts:async()=>{reads++;return [{sharedLinkContext:'{"repostedOriginalAvailable":true,"originalRead":false}',availableContexts:['shared_original']}]}})
  try{
    assert.equal(await b.generate({kind:'dm',uid:UID,text:'这是动态',availableContexts:['shared_link']}),'只知道你的转发附言，原帖还没看')
    assert.equal(reads,1)
  }finally{b.stop()}
})

test('没有宿主授予原帖菜单，模型直接索要 shared_original 必须拒绝并且不执行读取',async()=>{
  let reads=0
  const b=make({invoke:async()=>reply({action:'skip',reply:'',contextRequests:['shared_original']}),
    loadRequestedContexts:async()=>{reads++;return [{}]}})
  try{
    await assert.rejects(b.generate({kind:'dm',uid:UID,text:'普通对话',availableContexts:['shared_link']}),/模型未形成编号 0 的最终决定/)
    assert.equal(reads,0)
  }finally{b.stop()}
})

test('平台返回两个不同的原动态引用时，拒绝猜测其中一个',()=>{
  const f=fixture();try{
    f.store.recordRead(f.id,verifiedOuter([
      {relation:'reposted-original',kind:'dynamic',dynamicId:originalId},
      {relation:'reposted-original',kind:'dynamic',dynamicId:'8888888888888888'}
    ]),SCOPE)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
  }finally{f.close()}
})

test('失败或冷却提示不能统计为原动态真实读取命中；只接受经过核验的内容',async()=>{
  const seen=[]
  const b=make({invoke:async prompt=>{
      seen.push(prompt)
      return seen.length===1?reply({action:'skip',reply:'',contextRequests:['shared_original']}):reply({reply:'现在还没拿到原帖正文',messages:['现在还没拿到原帖正文']})
    },loadRequestedContexts:async()=>[{sharedOriginalContext:'请求保护中，原帖未读取'}]})
  try{
    assert.equal(await b.generate({kind:'dm',uid:UID,text:'那个原动态看了吗',availableContexts:['shared_original']}),'现在还没拿到原帖正文')
    assert.equal(seen.length,2)
    assert.match(seen[1],/原帖未读取/)
  }finally{b.stop()}
})

test('宿主实际读取门禁的源码契约：只读原帖且保持账号、安全预算及可选动作',async()=>{
  const {readFileSync}=await import('node:fs')
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const start=host.indexOf('loadRequestedContexts:async(batch,requestedByIndex)=>')
  assert.ok(start>0)
  const part=host.slice(start,start+11000)
  assert.match(part,/wantsOriginal/)
  assert.match(part,/repostedOriginalForParent/)
  assert.match(part,/executeSharedBiliLinkRead\(original\.id,scope\)/)
  assert.match(part,/if\(original\.status==='inspected'\)/)
  assert.match(part,/root\?\.senderUid===String\(input\.uid\)/)
  assert.match(part,/!accountBinding\.status\(\)\.blocked/)
  assert.match(part,/\['read-budget-blocked','resource-deferred','share-permission-revoked'\]\.includes\(proof\?\.code\)/)
  assert.match(part,/recordSharedBiliLinkDeferral\(original\.id/ )
  assert.doesNotMatch(part,/executeSharedDynamicWrite|bili_dynamic_like_life|bili_dynamic_comment_life/)
})

import {sharedVideoTargetAllowed,projectSharedVideoObservation,sharedVideoReadFailure,sharedLinkTurnRows} from '../lib/shared-video-observation.mjs'
test('only trusted same-account inspected share permits actual video observation; metadata is not visual evidence',()=>{
 const bvid='BV1rV1FzYEbP',row={senderUid:UID,status:'inspected',resolvedKind:'video',evidenceLevel:'video-metadata-only',bvid}
 const input={row,uid:UID,role:'owner',scope:SCOPE,currentScope:SCOPE,enabled:true,permitted:true,offered:true}
 assert.equal(sharedVideoTargetAllowed(input),true)
 for(const patch of [{role:'stranger'},{uid:'1'},{currentScope:SCOPE2},{enabled:false},{permitted:false},{offered:false},{row:{...row,status:'pending'}}])assert.equal(sharedVideoTargetAllowed({...input,...patch}),false)
 const result={ok:true,bvid,viewDepth:'standard',info:{duration:30},visual:{ok:true,status:'analyzed'},videoEvidence:{schema:'life-video-evidence/v1',bvid,verifiedContent:true,sources:[{kind:'preview_visual_analysis',status:'analyzed',timePointsMs:[0,1000]},{kind:'subtitle',status:'verified'}]},perceptionHandoff:{schema:'life-video-perception-handoff/v1',bvid,video:{source:'low-resolution-preview',frameCount:2,frameTimesMs:[0,1000],modelDescription:'实际图像观察'},speech:{source:'official-subtitles',textExcerpt:'真实字幕'}}}
 const observed=projectSharedVideoObservation(result,bvid);assert.equal(observed.verified,true);assert.equal(observed.visualObserved,true);assert.equal(observed.speechAvailable,true);assert.equal(observed.fullPlayback,false);assert.equal(observed.visualEvidenceKind,'fresh');assert.equal(projectSharedVideoObservation({...result,visual:{ok:true,status:'cached'}},bvid).visualEvidenceKind,'cached')
 assert.equal(projectSharedVideoObservation({...result,visual:{ok:false}},bvid).visualObserved,false)
 assert.equal(projectSharedVideoObservation({...result,videoEvidence:{...result.videoEvidence,sources:[]}},bvid).verified,false)
 assert.equal(projectSharedVideoObservation({...result,perceptionHandoff:{...result.perceptionHandoff,bvid:'BV1234567890'}},bvid).verified,false)
})
test('same DM model chooses metadata first, then a host-offered actual share observation; no unsolicited video read',async()=>{
 const prompts=[],loads=[];const b=make({invoke:async prompt=>{prompts.push(prompt);return prompts.length===1?reply({contextRequests:['shared_link']}):prompts.length===2?reply({contextRequests:['shared_video']}):reply({reply:'采样画面是动物',messages:['采样画面是动物']})},loadRequestedContexts:async(_batch,requests)=>{loads.push(requests);return loads.length===1?[{sharedLinkContext:'{"verified":true,"watched":false}',availableContexts:['shared_video']}]:[{sharedVideoContext:'{"verified":true,"visualObserved":true,"visualDescription":"动物"}'}]}})
 try{const result=await b.generate({kind:'dm',uid:UID,text:'看看这个视频',socialAutonomy:true,availableContexts:['shared_link']});assert.equal(result.action,'reply');assert.deepEqual(loads,[[['shared_link']],[['shared_video']]]);assert.match(prompts[1],/read_shared_video/);assert.match(prompts[2],/visualObserved/)}finally{b.stop()}
})

test('cross-turn link menu uses trusted contact and bounded references, not wording or automatic reads',()=>{
 const a={id:'a'.repeat(24),senderUid:UID},b={id:'b'.repeat(24),senderUid:UID},other={id:'c'.repeat(24),senderUid:'12345'}
 let lookups=0;const params={uid:UID,allowHistory:true,recentForContact:()=>{lookups++;return [a,b,other]},getLink:id=>[a,b,other].find(x=>x.id===id)}
 assert.deepEqual(sharedLinkTurnRows(params),[a,b]);assert.equal(lookups,1)
 assert.deepEqual(sharedLinkTurnRows({...params,allowHistory:false}),[]);assert.equal(lookups,1)
 assert.deepEqual(sharedLinkTurnRows({...params,currentLinks:[a]}),[a]);assert.equal(lookups,1)
 assert.deepEqual(sharedLinkTurnRows({...params,recentForContact:()=>[other,a]}),[a])
})
test('the model can select a prior share for a natural follow-up, or ignore the menu',async()=>{
 const ids=['a'.repeat(24),'b'.repeat(24)],seen=[];let calls=0
 const b=make({invoke:async()=>++calls===1?reply({contextRequests:['shared_link'],sharedLinkChoiceId:ids[1]}):calls===2?reply({contextRequests:['shared_video']}):reply({reply:'看到可信画面',messages:['看到可信画面']}),loadRequestedContexts:async(batch,req)=>{seen.push([batch[0].sharedLinkId,req[0][0]]);return req[0][0]==='shared_link'?[{sharedLinkContext:'{"verified":true,"watched":false}',availableContexts:['shared_video']}]:[{sharedVideoContext:'{"verified":true,"visualObserved":true,"visualEvidenceKind":"cached"}'}]}})
 try{const input={kind:'dm',uid:UID,role:'owner',text:'能看到视频画面吗',availableContexts:['shared_link'],sharedLinkCandidates:ids.map(id=>({id,label:'近期分享'})),socialAutonomy:true};assert.equal((await b.generate(input)).action,'reply');assert.deepEqual(seen,[[ids[1],'shared_link'],[ids[1],'shared_video']]);const count=seen.length;await b.generate({...input,text:'晚安'});assert.equal(seen.length,count)}finally{b.stop()}
})

test('owner shared video returns precise safe vision failure alongside real speech, and feeds it to same model',async()=>{
 const bvid='BV1rV1FzYEbP',result={ok:true,bvid,viewDepth:'standard',info:{duration:30},
  visual:{ok:false,status:'vision_incomplete',visionBoardReceipts:[{status:'analyzed'},{status:'incomplete',errorCode:'vision_board_time_mismatch',error:'private model raw'}]},
  videoEvidence:{schema:'life-video-evidence/v1',bvid,verifiedContent:true,sources:[{kind:'subtitle',status:'verified'}]},
  perceptionHandoff:{schema:'life-video-perception-handoff/v1',bvid,speech:{source:'official-subtitles',textExcerpt:'真实字幕'}}}
 const observed=projectSharedVideoObservation(result,bvid)
 assert.equal(observed.verified,true);assert.equal(observed.visualObserved,false);assert.equal(observed.speechAvailable,true)
 assert.equal(observed.visualFailure.code,'vision_board_time_mismatch');assert.equal(observed.visualFailure.boardsTotal,2);assert.equal(observed.visualFailure.boardsFailed,1)
 assert.equal(observed.visualDescription,undefined);assert.doesNotMatch(JSON.stringify(observed),/private model raw/)
 assert.equal(projectSharedVideoObservation({...result,visual:{...result.visual,visionBoardReceipts:[{status:'incomplete',errorCode:'untrusted-raw'}]}},bvid).visualFailure.code,'vision_incomplete')
 assert.equal(projectSharedVideoObservation(result,'BV1234567890').visualFailure,undefined)
 let prompts=[],reads=0;const b=make({invoke:async prompt=>{prompts.push(prompt);return prompts.length===1?reply({contextRequests:['shared_video']}):reply({reply:'画面没有看完整，只看到了字幕',messages:['画面没有看完整，只看到了字幕']})},captureReadScope:()=>()=>true,loadRequestedContexts:async()=>{reads++;return [{sharedVideoContext:JSON.stringify(observed)}]}})
 try{const r=await b.generate({kind:'dm',uid:UID,role:'owner',trigger:'incoming',messageId:'owner-read-1',text:'看看画面',socialAutonomy:true,availableContexts:['shared_video']});assert.equal(r.action,'reply');assert.equal(reads,1);assert.match(prompts[1],/vision_board_time_mismatch/);assert.match(prompts[1],/真实字幕/);assert.doesNotMatch(prompts[1],/private model raw/)}finally{b.stop()}
})


test('shared observation distinguishes preflight, tool failure and rejected final evidence without claiming a watch',()=>{
 const bvid='BV1rV1FzYEbP',result={ok:true,bvid,viewDepth:'standard',info:{duration:30},
  videoEvidence:{schema:'life-video-evidence/v1',bvid,verifiedContent:true,sources:[{kind:'subtitle',status:'verified'}]},
  perceptionHandoff:{schema:'life-video-perception-handoff/v1',bvid,speech:{source:'official-subtitles',textExcerpt:'真实字幕'}}}
 for(const [patch,status,stage] of [
  [{visionDecision:'vision-disabled',visual:{status:'未启用视觉'}},'vision-not-ready','preflight'],
  [{visual:{ok:false,status:'vision_model_unavailable'}},'vision-not-ready','preflight'],
  [{visual:{ok:false,error:'PRIVATE RAW EXCEPTION'}},'visual-read-failed','read'],
  [{visual:{ok:true,status:'analyzed',description:'UNVERIFIED MODEL TEXT'}},'visual-read-unverified','evidence'],
  [{visual:{ok:true,status:'cached'}},'visual-read-unverified','evidence'],
  [{visual:{ok:false,status:'no_images_confirmed'}},'visual-read-unverified','evidence']]){
  const observed=projectSharedVideoObservation({...result,...patch},bvid)
  assert.equal(observed.visualObserved,false);assert.equal(observed.speechAvailable,true)
  assert.equal(observed.visualFailure.status,status);assert.equal(observed.visualFailure.stage,stage)
  assert.equal(observed.visualDescription,undefined);assert.doesNotMatch(JSON.stringify(observed),/PRIVATE RAW|UNVERIFIED MODEL/)
 }
 for(const [reason,status] of [['video-visual-busy','life-vision-resource-unavailable'],['resource-deferred','life-vision-resource-unavailable'],['authorization-changed','authorization-changed'],['PRIVATE RAW EXCEPTION','visual-read-failed']]){
  const observed=sharedVideoReadFailure(reason)
  assert.equal(observed.verified,false);assert.equal(observed.visualObserved,false);assert.equal(observed.speechAvailable,false)
  assert.equal(observed.visualFailure.status,status);assert.doesNotMatch(JSON.stringify(observed),/PRIVATE RAW/)
 }
})

// Exercise the actual host dispatch/trace path, not only its projection helper.
test('production shared video dispatch settles failed lease and revoked account without exposing results',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const start=source.indexOf('  const readSharedVideoObservation=async(input)=>{')
 const stop=source.indexOf('  const socialRhythm=',start)
 assert.ok(start>=0&&stop>start)
 for(const scenario of ['busy','revoked','throw','success']){
  const bvid='BV1rV1FzYEbP',row={id:'a'.repeat(24),bvid},steps=[];let generation=1,calls=0,finished=null
  const verified={ok:true,bvid,viewDepth:'standard',info:{duration:30},visual:{ok:true,status:'analyzed'},
   videoEvidence:{schema:'life-video-evidence/v1',bvid,verifiedContent:true,sources:[{kind:'preview_visual_analysis',status:'analyzed',timePointsMs:[0,1000]}]},
   perceptionHandoff:{schema:'life-video-perception-handoff/v1',bvid,video:{source:'low-resolution-preview',frameCount:2,frameTimesMs:[0,1000],modelDescription:'ACTUAL VERIFIED FRAME'}}}
  const ctx={trustedLifeAccountTag:()=>SCOPE,accountBinding:{generation:()=>generation},getSessionIntegration:()=>({mode:'active',revision:1}),
   lifeSharedBiliLinks:{get:()=>row},currentSharedVideoTarget:()=>true,stateDir:'/not-used',
   lifeDecisionTrace:{begin:()=>({step:(type,fields)=>steps.push({type,...fields}),finish:r=>{finished=r}})},
   lifeResourceScheduler:{run:async(_opts,fn)=>{if(scenario==='throw')throw Error('PRIVATE RAW');return fn()}},
   withLifeVideoVisualLease:async(_dir,_target,fn)=>scenario==='busy'?{ok:false,reason:'video-visual-busy'}:fn(),
   executeWatchVideo:async()=>{calls++;if(scenario==='revoked')generation++;return verified},
   projectSharedVideoObservation,sharedVideoReadFailure,sharedLinkReadDeferral:()=>({code:'resource-deferred'}),
   lifeAgentEvents:{recordDecision:()=>{}},log:()=>{}}
  runInNewContext(source.slice(start,stop)+'\nglobalThis.run=readSharedVideoObservation',ctx)
  const observed=await ctx.run({uid:UID,sharedLinkScope:SCOPE,sharedLinkId:row.id})
  const receipt=steps.find(x=>x.type==='execution-result');assert.ok(receipt);assert.equal(finished.state,'finished')
  assert.equal(calls,['busy','throw'].includes(scenario)?0:1)
  if(scenario==='success'){assert.equal(observed.visualObserved,true);assert.equal(receipt.result,'verified')}
  else{assert.equal(observed.visualObserved,false);assert.equal(receipt.result,'failed');assert.equal(receipt.visualStatus,scenario==='revoked'?'authorization-changed':'life-vision-resource-unavailable');assert.doesNotMatch(JSON.stringify(observed),/ACTUAL VERIFIED FRAME|PRIVATE RAW/)}
 }
})

test('partial observations return to same social decision without promoting a watch',()=>{
 const bvid='BV1rV1FzYEbP',result={ok:true,bvid,viewDepth:'standard',visual:{status:'vision_incomplete'},
  videoEvidence:{schema:'life-video-evidence/v1',bvid,sources:[]},
  perceptionHandoff:{schema:'life-video-perception-handoff/v1',bvid,video:{partialCellObservations:[{atMs:1000,description:'可见鸟。',status:'partial-model-generated-unverified'}]}}}
 const row=projectSharedVideoObservation(result,bvid)
 assert.equal(row.verified,false);assert.equal(row.visualObserved,false);assert.equal(row.partialVisual.fullReceipt,false)
 assert.deepEqual(row.partialVisual.cells,[{atMs:1000,description:'可见鸟。'}]);assert.equal(row.visualDescription,undefined)
 assert.equal(projectSharedVideoObservation({...result,visual:{status:'vision_unavailable'}},bvid).partialVisual,undefined)
})
