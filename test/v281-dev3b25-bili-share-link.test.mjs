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

test('short-link redirects consume one shared read-budget admission per hop',async()=>{
  const seen=[],markers=[]
  const destinations=[
    'https://b23.tv/nextCode',
    'https://www.bilibili.com/video/BV1xx411c7mD?from=share'
  ]
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'}, {
    fetchImpl:async(url,opts)=>{
      seen.push({url,opts})
      return {status:302,headers:{get:()=>destinations.shift()},body:{cancel:async()=>{}}}
    },
    requestGuard:async(kind,task)=>{markers.push(kind);return task()}
  })
  assert.equal(result.ok,true)
  assert.equal(result.kind,'video')
  assert.equal(seen.length,2)
  assert.deepEqual(markers,['shared-link-resolve','shared-link-resolve'])
})

test('short-link budget cooldown is surfaced as a deferral, not a content failure',async()=>{
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'}, {
    fetchImpl:async()=>{throw Error('must not run')},
    requestGuard:async()=>{const error=Error('cooldown');error.name='BiliReadDeferredError';error.retryAt=123456;throw error}
  })
  assert.deepEqual(result,{ok:false,code:'read-budget-blocked',retryAt:123456})
})

test('HTTP 429 short-link resolution is a shared-budget deferral',async()=>{
  let marker
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'}, {
    fetchImpl:async()=>({status:429,headers:{get:()=>null},body:{cancel:async()=>{}}}),
    requestGuard:async(kind,task)=>{const value=await task();marker={kind,...value};return value}
  })
  assert.equal(marker.kind,'shared-link-resolve')
  assert.equal(marker.status,429)
  assert.equal(marker.code,429)
  assert.equal(result.code,'read-budget-blocked')
})


test('short-link resource admission deferral is not misclassified as a network failure',async()=>{
  const error=Error('resource queue full');error.name='LifeResourceAdmissionError';error.code='life-resource-queue-full'
  const result=await resolveBiliShareLink({kind:'short',code:'pjKd41b'}, {
    fetchImpl:async()=>{throw Error('must not run')},requestGuard:async()=>{throw error}
  })
  assert.equal(result.ok,false)
  assert.equal(result.code,'resource-deferred')
  assert.ok(result.retryAt>Date.now())
})
