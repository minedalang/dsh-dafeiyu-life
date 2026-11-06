import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const html=read('lib/management-console.html'),js=read('lib/management-console.js'),persona=read('lib/persona-default.mjs')
test('生活页不再让用户选择旧档位，历史选项只按已保存值临时呈现',()=>{
 const select=html.match(/<select id="life-v2-pace">([\s\S]*?)<\/select>/)?.[1]||''
 assert.ok(select.includes('value="quiet"')&&select.includes('value="natural"')&&select.includes('value="lively"'))
 assert.doesNotMatch(select,/value="legacy-(?:quiet|natural|lively)"/)
 assert.match(js,/legacy\.dataset\.legacySelected='true'/)
 assert.match(js,/paceSelect\.value=savedPace/)
 assert.match(html,/id="life-legacy-pace-note"/)
})
test('新 Life 套餐只改生活和记忆反思，不含社交许可、隐私与人格原始账本',()=>{
 const code=js.slice(js.indexOf('const organicProfiles='),js.indexOf('const organicPlan='))
 for(const name of ['gentle','balanced','curious'])assert.match(code,new RegExp(name+':\\{pace:'))
 assert.doesNotMatch(code,/socialAutoSend|autoComment|autoVideoLike|autoVideoCollect|dmWhitelist|emotionRecallDmEnabled|privacy|enabled:true/)
 assert.match(js,/await proposedLifeSettings\(false\)/)
 assert.match(js,/await request\('\/config',Object\.fromEntries\(changes\)\)/)
 assert.match(html,/id="life-organic-apply"/)
})
test('管理中心全部为站内样式确认和输入，不使用系统原生对话框',()=>{
 assert.doesNotMatch(js,/(?:window\.)?\b(?:confirm|prompt|alert)\s*\(/)
 assert.match(js,/const confirmAction=/)
 assert.match(js,/const inputAction=/)
 assert.match(js,/if\(dialog.open\)\{resolve\(false\);return\}dialog.returnValue=''/,'repeat confirmation must clear prior returnValue before Escape')
 assert.match(js,/if\(dialog.open\)\{resolve\(null\);return\}dialog.returnValue=''/,'input dialog must also reset prior returnValue')
 assert.match(html,/id="action-input-dialog"/)
 assert.match(html,/id="action-confirm-dialog"/)
 assert.match(html,/\.action-dialog-backdrop/)
 assert.match(js,/ownerCheck\.addEventListener\('change',async\(\)=>/)
 assert.match(js,/title:'保存生活设置？'/)
})
test('负向开关写回旧授权键只执行一次取反；已关闭的老用户不因为标签改变而放开',()=>{
 for(const id of ['bili-auto-comment','bili-auto-like','bili-auto-collect','bili-favorite-delete']){
  const tag=html.match(new RegExp('<input id="'+id+'"[^>]+>'))?.[0]||''
  assert.match(tag,/data-inverted-permission="true"/)
 }
 assert.match(js,/dataset\.invertedPermission==='true'\?c\[key\]!==true:c\[key\]===true/)
 assert.match(js,/dataset\.invertedPermission==='true'\?!\$\(id\)\.checked:\$\(id\)\.checked/)
 assert.match(html,/额外允许自主关注／取关 UP 主（默认不授权）/)
})
test('视频兴趣私信仍显示独立链路，旧四项内部调试卡不向普通用户显示',()=>{
 assert.match(js,/request\('\/social-intentions'\)/)
 assert.match(html,/id="life-link-sharing"/)
 for(const id of ['read-action-executions-section','outbound-action-executions-section','todo-transactions-section','video-discussion-acceptance']){
  assert.match(html,new RegExp('id="'+id+'"[^>]*\\bhidden\\b'))
 }
 assert.match(html,/\[hidden\]\[data-retired-internal\]/)
})
test('默认人格不再强行规定兴趣领域，但保留原人物设定',()=>{
 assert.doesNotMatch(persona,/偏爱搞笑、游戏、AI/)
 assert.match(persona,/会自己从真实经历中探索喜欢的内容/)
 assert.match(persona,/Claude 小姐/)
})

const NOW=Date.parse('2026-11-04T12:00:00Z'), DAY=86400000
const cfg=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionMemoryHalfLifeDays:90})
async function withExperience(fn){
 const dir=mkdtempSync(join(tmpdir(),'rc-real-personality-')),clock={at:NOW}
 const memory=createLifeMemoryGateway({dataDir:dir,getConfig:cfg,now:()=>clock.at,getRelationship:()=>({stage:'familiar',permissionRole:'stranger',whitelisted:false})})
 const personality=createPersonalityEvolution({dataDir:dir,memoryGateway:memory,now:()=>clock.at})
 try{personality.setEnabled(true);return await fn({dir,clock,memory,personality})}finally{memory.close();rmSync(dir,{recursive:true,force:true})}
}
const event=(i,day=0)=>({kind:'social',key:`social:${20000+i}:BV1234567890:${30000+i}`,bvid:'BV1234567890',actorUid:String(20000+i),text:'鱼鱼，能不能多聊聊这个话题，我真的想知道一些细节？',socialTier:'stranger',at:NOW-day*DAY})
test('证实的真实评论回复才形成表达、耐心或边界的弱观察，去重且不能泄漏正文',()=>withExperience(({dir,memory,personality})=>{
 const cases=[
  {reply:'我觉得这个观点挺有趣，不过我更倾向于自己的理解。',trait:'assertiveness'},
  {reply:'我理解你的问题，因为要考虑前面提到的背景，比如数据来源、实际场景和上下文，所以不能只凭一句话判断。',trait:'patience'},
  {reply:'这个要求我不方便答应，请不要继续催促啦。',trait:'boundaries'},
 ]
 const ev=cases.map((x,i)=>event(i+1,i))
 memory.recordEvents(ev)
 for(let i=0;i<cases.length;i++){
  const x=cases[i],e=ev[i];assert.equal(memory.recordSocialReply({actorUid:e.actorUid,bvid:e.bvid,incomingRpid:e.key.split(':').at(-1),text:x.reply}).ok,true)
 }
 const rows=ev.map(e=>({key:e.key,kind:'social'}))
 assert.equal(personality.observeVerifiedExploration(rows).observed,6)
 for(const x of cases){const t=personality.status().traits.find(t=>t.id===x.trait);assert.equal(t.evidenceCount,1);assert.equal(t.stage,'observed')}
 assert.equal(personality.status().timeline.filter(row=>row.source==='verified-reply').length,3,'confirmed reply provenance must survive reload')
 assert.equal(personality.observeVerifiedExploration(rows).observed,0)
 const raw=readFileSync(join(dir,'personality-evolution/v1.json'),'utf8')
 for(const x of cases)assert.ok(!raw.includes(x.reply))
 for(const e of ev)assert.ok(!raw.includes(e.actorUid))
 assert.doesNotMatch(personality.context({scene:'dm'}),/表达不同意见|耐心倾听|社交边界/,'每项只有一次弱观察，不应直接改变相应表达风格')
}))
test('没有回执、未解决的发送和遗忘经历不能被统计为表达成长',()=>withExperience(({clock,memory,personality})=>{
 const e=event(40,1);memory.recordEvents([e])
 assert.equal(personality.observeVerifiedExploration([{key:e.key,kind:'social'}]).observed,0)
 memory.recordSocialReply({actorUid:e.actorUid,bvid:e.bvid,incomingRpid:e.key.split(':').at(-1),text:'我觉得这个有点不一样，不过可以一起看看。'})
 clock.at+=370*DAY
 assert.equal(personality.observeVerifiedExploration([{key:e.key,kind:'social'}]).observed,0)
 for(const t of personality.status().traits)assert.equal(t.evidenceCount,0)
}))
