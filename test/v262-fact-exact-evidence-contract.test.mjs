import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifeFactFromReceipt,verifyLifeOutbound} from '../lib/verified-life-facts.mjs'

const at=Date.parse('2026-11-03T12:00:00Z'),uid='210228238',other='485221842'
const A='BV1abc234567',B='BV1abc234568'
const typeOperation={
  video_visual_inspected:'verified-video-visual',audio_playback_verified:'verified-audio-playback',
  video_full_view_verified:'verified-video-complete',audio_full_playback_verified:'verified-audio-complete',
  video_uploaded_verified:'platform-upload-receipt',video_metadata_read:'public-video-metadata',
}
const fact=(type,bvid=A,opts={})=>lifeFactFromReceipt({type,operation:typeOperation[type],ok:true,bvid,sourceId:`${type}:${bvid}`,
  at,scope:opts.scope||'public',uid:opts.uid||'',channel:opts.channel||''})
const check=(text,events,opts={})=>verifyLifeOutbound(text,{uid,channel:'dm',at,events,...opts})

test('跨感官事实反例：视觉不是听音，听音也不是视觉',()=>{
  assert.equal(check('我亲耳听过这首歌',[fact('video_visual_inspected')]).code,'unverified-sensory')
  assert.equal(check('我亲眼看过这个视频',[fact('audio_playback_verified')]).code,'unverified-sensory')
  assert.equal(check('我亲耳听过歌曲 '+A,[fact('audio_playback_verified')]).ok,true)
  assert.equal(check('我看了视频 '+A+' 的几帧画面',[fact('video_visual_inspected')]).ok,true)
})
test('跨 BV 反例：视频 A 的视听及投稿回执不能证明视频 B',()=>{
  for(const [sentence,types] of [
    ['我刚看过视频 '+B,['video_visual_inspected']],
    ['我听过歌曲 '+B,['audio_playback_verified']],
    ['我自己发布了视频 '+B,['video_uploaded_verified']],
  ])assert.equal(check(sentence,types.map(t=>fact(t,A))).ok,false,sentence)
  assert.equal(check('我看过视频 '+A,[fact('video_visual_inspected',A)]).ok,true)
  assert.equal(check('我看过这个视频',[fact('video_visual_inspected',A)],{ownerText:'你看过 '+B+' 吗？'}).ok,false)
  assert.equal(check('我看过这个视频',[fact('video_visual_inspected',A)],{ownerText:'你看过 '+A+' 吗？'}).ok,true)
})
test('有几帧／播放记录不能冒充看完整片或听完整首',()=>{
  for(const text of ['我完整看过视频 '+A,'我亲眼看完视频 '+A])
    assert.equal(check(text,[fact('video_visual_inspected')]).code,'unverified-sensory',text)
  for(const text of ['我亲耳听完了这首歌','我听了整首歌 '+A])
    assert.equal(check(text,[fact('audio_playback_verified')]).code,'unverified-sensory',text)
  assert.equal(check('我完整看过视频 '+A,[fact('video_full_view_verified')]).ok,true)
  assert.equal(check('我听完了这首歌',[fact('audio_full_playback_verified')]).ok,true)
})
test('不能从多个无关事实中猜出未说明对象；不能串 UID、渠道或时效',()=>{
  assert.equal(check('我看过那个视频',[fact('video_visual_inspected',A),fact('video_metadata_read',B)]).ok,false)
  assert.equal(check('我看过视频 '+A,[fact('video_visual_inspected',A,{scope:'recipient-private',uid:other,channel:'dm'})]).ok,false)
  assert.equal(check('我看过视频 '+A,[fact('video_visual_inspected',A,{scope:'recipient-private',uid,channel:'comment'})]).ok,false)
  assert.equal(check('我看过视频 '+A,[fact('video_visual_inspected')],{at:at+26*3600_000}).ok,false)
  assert.equal(check('我没听过这首歌，也没看完这个视频',[]).ok,true)
})
test('统一人格的四条外发分支不再追加第二份情绪；主 Session 不再另挂成长提示',()=>{
  const social=readFileSync(new URL('../lib/social-intentions.mjs',import.meta.url),'utf8')
  const dynamic=readFileSync(new URL('../lib/daily-dynamic.mjs',import.meta.url),'utf8')
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const longTerm=readFileSync(new URL('../lib/long-term-memory.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(social,/当前角色情绪状态只有粗粒度标签|强度\$\{Math.max/)
  assert.doesNotMatch(dynamic,/当前模拟情绪标签（仅为风格参考）|JSON\.stringify\(moodHint\)/)
  assert.doesNotMatch(host,/`关系阶段：\$\{stage\|\|'new'\}；模拟精力/)
  assert.doesNotMatch(longTerm,/'dafeiyu-growth'/)
  for(const file of [social,dynamic,host])assert.match(file,/lifeVoiceContext|getVoiceContext/)
})
