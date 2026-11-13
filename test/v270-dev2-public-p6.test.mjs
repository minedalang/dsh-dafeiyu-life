import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {createSocialInteractionRhythm} from '../lib/social-interaction-rhythm.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';

const SELF='999',PERSON='47722',BV='BV1ignA6REjB';
const timestamp=1790000000000;
const payload=(id,t=timestamp,content='@大肥鱼 有个问题想问')=>({id,at_time:Math.floor(t/1000),user:{mid:PERSON,nickname:'测试用户'},
  item:{business_id:1,subject_id:'777',source_id:String(id+500),root_id:'888',target_id:'888',
    source_content:content,uri:`https://www.bilibili.com/video/${BV}`,at_details:[{mid:SELF}]}});
const raw=items=>({at:{code:0,data:{items}}});
async function fixture(run,{p6At=true,p6Comment=false,replyPerPoll=5,p6MaxBubbles=2,delayMinMinutes=5,delayMaxMinutes=360}={}){
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-public-'));
  let clock=timestamp,notices=[payload(1)],calls=[],sends=[];
  const config={watchAt:true,replyAt:true,p6At,p6Comment,p6MaxBubbles,delayMinMinutes,delayMaxMinutes,watchReplies:true,replyPerPoll,replyPerDay:20,
    globalDailyLimit:100,ownTopPerUser:15,ownNestedPerUser:15};
  let behavior=req=>({action:'skip'});
  const engine=createCommentInteract({dataDir,getConfig:()=>config,selfUid:async()=>SELF,now:()=>clock,
    getAtNotifications:async()=>raw(notices),getNotifications:async()=>({data:{replies:[]}}),
    getAtSource:async x=>({ok:true,uid:x.uid,rpid:x.rpid,bvid:x.bvid,text:'核实的 B站 来源评论'}),
    getOwnComments:async()=>({top:[],nested:[]}),
    getVideoContext:async()=>({usable:true,text:'已核实视频内容'}),
    generateReply:async req=>{calls.push(req);return behavior(req)},
    send:async req=>{sends.push(req);return {ok:true,rpid:String(500000+sends.length)}},
    logger:{warn(){},error(){}}});
  try{
    await engine.poll({mentions:true,notifications:false,top:false});
    await run({engine,config,sends,calls,add:(id,t=clock)=>notices.push(payload(id,t)),
      tick:milliseconds=>{clock+=milliseconds},time:()=>clock,model:fn=>{behavior=fn},
      state:async()=>JSON.parse(await readFile(join(dataDir,'comment-interact-state.json'),'utf8')),
      ledger:()=>null});
  }finally{await rm(dataDir,{recursive:true,force:true})}
}

test('public P6 disabled still produces a single legacy reply without any scheduled send',async()=>fixture(async h=>{
  h.model(()=> '原有的一条回复');h.add(6);
  const result=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(result.sent,1);assert.equal(h.sends.length,1);
  assert.equal(h.ledger(),null);
  assert.equal(h.calls[0].socialAutonomy,false);
},{p6At:false}));

test('public P6 additional bubbles never bypass the per-poll cap',async()=>fixture(async h=>{
  h.model(()=>({action:'reply',messages:['一','二','三']}));h.add(7);
  const result=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.ok(result.sent<=2);assert.ok(result.sent>=1);assert.deepEqual(h.sends.map(x=>x.text),['一'].slice(0,result.sent));
},{replyPerPoll:2}));

test('cross-channel rhythm enforces a shared per-UID cooldown and stops uncertain duplicate attempts',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-rhythm-'));let clock=timestamp;
  try{
    const rhythm=createSocialInteractionRhythm({dataDir,getAccountUid:()=>SELF,now:()=>clock,crossChannelMinutes:30});
    const dm=rhythm.reserve({uid:PERSON,channel:'dm'});assert.equal(dm.ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'at'}).reason,'prior-outcome-unresolved');
    assert.equal(rhythm.settle(dm.id,{outcome:'sent'}).reason,'missing-platform-receipt');
    assert.equal(rhythm.settle(dm.id,{outcome:'sent',receiptId:'verified-dm-key'}).ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'at'}).reason,'cross-channel-cooldown');
    clock+=31*60000;
    const at=rhythm.reserve({uid:PERSON,channel:'at'});assert.equal(at.ok,true);
    assert.equal(rhythm.settle(at.id,{outcome:'uncertain'}).ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'dm'}).reason,'prior-outcome-unresolved');
    assert.doesNotMatch(readFileSync(rhythm.file,'utf8'),new RegExp(PERSON+'|verified-dm-key'));
  }finally{await rm(dataDir,{recursive:true,force:true})}
});

test('public autonomy uses the same Life Voice and rejects public replies over 130 chars',async()=>{
  const x=createInteractionBatcher({invoke:async()=>JSON.stringify({items:[{id:'0',action:'reply',messages:['a'.repeat(131)],reply:'',mood:'neutral',intensity:0}]}),
    getPersona:()=> '唯一 Life Voice 情绪人格',delayMs:0,logger:{warn(){},error(){}}});
  const result=await x.generate({kind:'comment',uid:PERSON,text:'内容',socialAutonomy:true,socialChannel:'at',threadKey:'at:BV:1'});
  assert.equal(result.action,'skip');assert.equal(result.reason,'public-bubble-too-long');x.stop();
});

test('public P6 configurable max bubble limit reduces outgoing sends even if AI proposes three',async()=>fixture(async h=>{
  h.model(()=>({action:'reply',messages:['第一段','第二段','第三段']}));h.add(31);
  const res=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(res.sent,1);assert.deepEqual(h.sends.map(x=>x.text),['第一段']);
},{p6MaxBubbles:1}));

