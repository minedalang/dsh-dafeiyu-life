import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchMsgs} from '../lib/dm.mjs'

const cred={sessdata:'fake',bili_jct:'fake',buvid3:'fake',dedeuserid:999}
async function readCard(msg){
  const original=globalThis.fetch
  globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{messages:[{
    sender_uid:123,timestamp:1_800_000_000,msg_key:'1234567890123',msg_type:msg.type,
    content:JSON.stringify(msg.content)
  }]}}),{status:200,headers:{'content-type':'application/json'}})
  try{return (await fetchMsgs(cred,123,10))[0]}
  finally{globalThis.fetch=original}
}

test('msg_type=7 source=11 preserves the official dynamic URL for Life',async()=>{
  const row=await readCard({type:7,content:{source:11,id:1234567890123456,title:'今天做的饭',author:'花花',url:'https://b23.tv/pjKd41b'}})
  assert.equal(row.kind,7)
  assert.match(row.text,/分享动态/)
  assert.match(row.text,/今天做的饭/)
  assert.match(row.text,/https:\/\/b23\.tv\/pjKd41b/)
})

test('msg_type=7 source=11 safely reconstructs a canonical dynamic URL when url is absent',async()=>{
  const row=await readCard({type:7,content:{source:11,id:1234567890123456,title:'饭做好啦'}})
  assert.match(row.text,/分享动态/)
  assert.match(row.text,/https:\/\/t\.bilibili\.com\/1234567890123456/)
})

test('msg_type=7 distinguishes video from dynamic and preserves only safe official links',async()=>{
  const video=await readCard({type:7,content:{source:5,id:123,title:'视频标题',bvid:'BV1xx411c7mD'}})
  assert.match(video.text,/分享视频/)
  assert.match(video.text,/https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD/)
  const unsafe=await readCard({type:7,content:{source:11,id:1234567890123456,title:'动态',url:'https://evil.example/x'}})
  assert.match(unsafe.text,/https:\/\/t\.bilibili\.com\/1234567890123456/)
  assert.doesNotMatch(unsafe.text,/evil\.example/)
})

test('msg_type=13/14 preserves safe Bilibili URLs but drops off-site targets',async()=>{
  const image=await readCard({type:13,content:{title:'好友动态卡片',jump_url:'https://t.bilibili.com/1234567890123456'}})
  assert.equal(image.kind,13)
  assert.match(image.text,/网页卡片/)
  assert.match(image.text,/https:\/\/t\.bilibili\.com\/1234567890123456/)
  const live=await readCard({type:14,content:{title:'直播卡片',url:'https://evil.example/live'}})
  assert.equal(live.kind,14)
  assert.match(live.text,/分享内容/)
  assert.doesNotMatch(live.text,/evil\.example/)
})

test('legacy msg_type=8 is not misclassified as a share video',async()=>{
  const row=await readCard({type:8,content:{title:'不应被误认为视频',author:'某人',url:'https://b23.tv/pjKd41b'}})
  assert.equal(row.text,'[非文字消息]')
})
