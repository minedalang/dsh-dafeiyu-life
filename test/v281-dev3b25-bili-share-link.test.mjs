import test from 'node:test'
import assert from 'node:assert/strict'
import {parseBiliShareUrl,extractBiliShareLinks,resolveBiliShareLink} from '../lib/bili-share-link.mjs'

test('parses only HTTPS Bilibili dynamic/video/profile links',()=>{
  assert.deepEqual(parseBiliShareUrl('https://b23.tv/pjKd41b'),{kind:'short',code:'pjKd41b'})
  assert.deepEqual(parseBiliShareUrl('https://t.bilibili.com/1234567890123456?share_source=copy_web'),{kind:'dynamic',dynamicId:'1234567890123456'})
  assert.deepEqual(parseBiliShareUrl('https://www.bilibili.com/opus/1234567890123456'),{kind:'dynamic',dynamicId:'1234567890123456'})
  assert.deepEqual(parseBiliShareUrl('https://m.bilibili.com/dynamic/1234567890123456'),{kind:'dynamic',dynamicId:'1234567890123456'})
  assert.deepEqual(parseBiliShareUrl('https://www.bilibili.com/video/BV1xx411c7mD'),{kind:'video',bvid:'BV1xx411c7mD'})
  assert.deepEqual(parseBiliShareUrl('https://www.bilibili.com/video/av12345678'),{kind:'video',aid:'12345678'})
  assert.deepEqual(parseBiliShareUrl('https://space.bilibili.com/202573574'),{kind:'profile',uid:'202573574'})
})

test('rejects non-HTTPS, credentials, ports, fragments and non-Bilibili hosts',()=>{
  for(const url of [
    'http://b23.tv/pjKd41b','https://evil.example/pjKd41b',
    'https://user@b23.tv/pjKd41b','https://b23.tv:8443/pjKd41b',
    'https://b23.tv/pjKd41b#fragment','https://www.bilibili.com.evil.example/opus/1234567890123456',
    'https://b23.tv/not/a/short-link','https://space.bilibili.com/video/BV1xx411c7mD'
  ])assert.equal(parseBiliShareUrl(url),null,url)
})

test('extracts at most two distinct safe links and trims Chinese punctuation',()=>{
  const refs=extractBiliShareLinks('来看看 https://b23.tv/pjKd41b。还有 https://t.bilibili.com/1234567890123456，外站 https://evil.example/a',{limit:2})
  assert.equal(refs.length,2)
  assert.equal(refs[0].code,'pjKd41b')
  assert.equal(refs[1].dynamicId,'1234567890123456')
  assert.equal(extractBiliShareLinks(String.raw`链接 JSON: https:\/\/b23.tv\/pjKd41b`).length,1)
})

test('short link resolution follows only official HTTPS Bilibili redirects without cookies',async()=>{
  const seen=[]
  const fetchImpl=async(url,opts)=>{
    seen.push({url,opts})
    return {status:302,headers:{get:name=>name.toLowerCase()==='location'?'https://www.bilibili.com/opus/1234567890123456?from=share':null},body:{cancel:async()=>{}}}
  }
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'},{fetchImpl})
  assert.deepEqual(result,{ok:true,kind:'dynamic',dynamicId:'1234567890123456',canonicalUrl:'https://t.bilibili.com/1234567890123456'})
  assert.equal(seen.length,1)
  assert.equal(seen[0].opts.redirect,'manual')
  assert.equal(seen[0].opts.credentials,'omit')
  assert.equal('Cookie' in (seen[0].opts.headers||{}),false)
})

test('blocks unsupported official redirect paths without fetching them',async()=>{
  let count=0
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'},{fetchImpl:async()=>{count++;return {status:302,headers:{get:()=> 'https://www.bilibili.com/blackboard/unsupported'},body:{cancel:async()=>{}}}}})
  assert.equal(result.code,'unsupported-bilibili-link');assert.equal(count,1)
})

test('blocks off-site redirects and never performs a second request',async()=>{
  let count=0
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'},{fetchImpl:async()=>{
    count++;return {status:302,headers:{get:()=> 'https://evil.example/collect'},body:{cancel:async()=>{}}}
  }})
  assert.equal(result.code,'offsite-redirect-blocked')
  assert.equal(count,1)
})
