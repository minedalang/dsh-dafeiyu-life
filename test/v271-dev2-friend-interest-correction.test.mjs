import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {explicitInterestStatements,observeFriendInterest,friendInterestSummary,friendRecommendationGuard,learnedFriendContext,listFriendLearning} from '../lib/friend-learning.mjs'
const directory=JSON.stringify([{uid:'11111',dm:true},{uid:'22222',dm:true}])
const today=Date.parse('2026-11-04T02:00:00Z')
const home=()=>mkdtempSync(join(tmpdir(),'fish-friend-correction-'))
const observed=(dir,id,text,uid='11111',at=today)=>observeFriendInterest(dir,{uid,text,source:'dm',eventId:id,friendDirectory:directory,now:at})

test('历史喜欢不能冒充当前喜欢；同消息转变只保留当前表达',()=>{
 assert.deepEqual(explicitInterestStatements('我以前喜欢古典音乐'),[])
 assert.deepEqual(explicitInterestStatements('我以前喜欢古典音乐，但现在不喜欢了'),[{topic:'古典音乐',stance:'dislike',confidence:'explicit-self-report'}])
 assert.deepEqual(explicitInterestStatements('我以前不喜欢电子音乐，现在喜欢了'),[{topic:'电子音乐',stance:'like',confidence:'explicit-self-report'}])
 assert.deepEqual(explicitInterestStatements('我以前喜欢古典音乐，现在喜欢电子音乐'),[{topic:'电子音乐',stance:'like',confidence:'explicit-self-report'}])
})

test('兴趣减弱不等于厌恶，不同的语言表达得到暂不确定',()=>{
 for(const phrase of ['其实我现在不太喜欢电子音乐了','我现在没那么喜欢电子音乐了','我现在不怎么喜欢电子音乐了']){
  const result=explicitInterestStatements(phrase)
  assert.deepEqual(result,[{topic:'电子音乐',stance:'uncertain',confidence:'explicit-self-report'}],phrase)
 }
 assert.deepEqual(explicitInterestStatements('现在不喜欢了'),[],'没有明确的同消息主语与主题，不猜测')
 assert.deepEqual(explicitInterestStatements('我朋友现在不喜欢电子音乐了'),[],'不冒充他人自述')
})

test('好友明确修订喜好，旧数据保留为证据但当前只显示新结论',()=>{
 const dir=home();try{
  assert.equal(observed(dir,'1','我喜欢电子音乐').added,1)
  assert.equal(observed(dir,'2','我现在不喜欢电子音乐了','11111',today+1000).added,1)
  const preference=friendInterestSummary(dir,'11111',directory,{now:today+1001})[0]
  assert.equal(preference.stance,'dislike')
  assert.equal(preference.status,'changed-recently')
  assert.equal(preference.support,2)
  assert.match(learnedFriendContext(dir,'11111',directory),/不喜欢「电子音乐」/)
  assert.doesNotMatch(learnedFriendContext(dir,'11111',directory),/(?:^|\n)- [^\n]*?：喜欢「电子音乐」；/)
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'电子音乐推荐',now:today+1001}).reason,'friend-rejected-topic')
  assert.equal(friendRecommendationGuard(dir,'22222',directory,{videoTitle:'电子音乐推荐',now:today+1001}).blocked,false)
  const db=readFileSync(join(dir,'friend-interest-observations.json'),'utf8')
  assert.doesNotMatch(db,/我喜欢|我现在|电子音乐推荐|11111.*我喜欢/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('不那么喜欢时暂缓主动推荐相关主题，不宣称对方讨厌',()=>{
 const dir=home();try{
  observed(dir,'1','我喜欢电子音乐')
  observed(dir,'2','我现在没那么喜欢电子音乐了','11111',today+1000)
  const preference=friendInterestSummary(dir,'11111',directory,{now:today+1001})[0]
  assert.equal(preference.stance,'uncertain')
  assert.equal(preference.status,'changed-recently')
  assert.match(learnedFriendContext(dir,'11111',directory),/兴趣减弱或尚未明确/)
  assert.doesNotMatch(learnedFriendContext(dir,'11111',directory),/不喜欢「电子音乐」/)
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'电子音乐入门',now:today+1001}).reason,'friend-interest-needs-reconfirmation')
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'烹饪入门',now:today+1001}).blocked,false)
  assert.match(JSON.stringify(listFriendLearning(dir,directory)),/uncertain/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('后来明确重新喜欢，解除原主题自动推荐的兴趣限制',()=>{
 const dir=home();try{
  observed(dir,'1','我喜欢电子音乐')
  observed(dir,'2','我现在不喜欢电子音乐了','11111',today+1000)
  observed(dir,'3','我现在又喜欢电子音乐了','11111',today+2000)
  assert.equal(friendInterestSummary(dir,'11111',directory,{now:today+2001})[0].stance,'like')
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'电子音乐推荐',now:today+2001}).blocked,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('同一毫秒记录按已落账顺序选择最新明确自述',()=>{
 const dir=home();try{
  observed(dir,'old','我喜欢美食')
  observed(dir,'new','我现在不喜欢美食了')
  const preference=friendInterestSummary(dir,'11111',directory,{now:today+1})[0]
  assert.equal(preference.stance,'dislike')
  assert.equal(preference.status,'changed-recently')
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'美食探店',now:today+1}).blocked,true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('单条重复事件不重复学习；未授权 UID 不建立人物兴趣',()=>{
 const dir=home();try{
  assert.equal(observed(dir,'same','我现在不喜欢美食了').added,1)
  assert.equal(observed(dir,'same','我现在不喜欢美食了').added,0)
  assert.equal(observed(dir,'stranger','我喜欢电子音乐','99999').added,0)
  assert.deepEqual(friendInterestSummary(dir,'99999',directory,{now:today}),[])
  assert.equal(friendInterestSummary(dir,'11111',directory,{now:today})[0].support,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('已经明确停止推荐，兴趣变化不得恢复退订与其他安全边界',()=>{
 const dir=home();try{
  observed(dir,'stop','以后别给我推荐视频了')
  observed(dir,'like','我现在喜欢电子音乐了','11111',today+1000)
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'电子音乐推荐',now:today+1001}).reason,'friend-globally-unsubscribed')
  assert.equal(friendRecommendationGuard(dir,'22222',directory,{videoTitle:'电子音乐推荐',now:today+1001}).blocked,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('明确不要推荐某主题的意愿优先于同条消息说喜欢该主题',()=>{
 const dir=home();try{
  const result=explicitInterestStatements('我喜欢美食，但别给我推荐美食')
  assert.deepEqual(result,[{topic:'美食',stance:'dislike',confidence:'explicit-recommendation-rejection'}])
  observed(dir,'no-send','我喜欢美食，但别给我推荐美食')
  assert.equal(friendRecommendationGuard(dir,'11111',directory,{videoTitle:'美食探店',now:today}).blocked,true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
