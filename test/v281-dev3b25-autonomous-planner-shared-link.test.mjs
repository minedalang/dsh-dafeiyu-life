import test from 'node:test'
import assert from 'node:assert/strict'
import {__test} from '../lib/autonomous-planner.mjs'

const id='0123456789abcdef01234567'
const pending={id,source:'friend-shared-bili-link',kind:'short',status:'pending',eligible:true}
const inspected={id,source:'friend-shared-bili-link',kind:'dynamic',status:'inspected',eligible:true,authorMatchesSharer:true,commentable:true,summary:'图片1：一盘家常菜'}
function menu(opportunities,flags={}){return __test.plannerActionMenu({candidates:[],opportunities,cues:[],intents:[],lifeEvents:[],lifeSkills:[],...flags})}

test('pending friend-shared safe link is a voluntary inspect choice, not an automatic task',()=>{
 const offered=menu([pending])
 assert.equal(offered.some(x=>x.action==='inspect_shared_link'&&x.ids.includes(id)),true)
 assert.equal(offered.some(x=>x.action==='like_shared_dynamic'),false)
 assert.equal(offered.some(x=>x.action==='comment_shared_dynamic'),false)
})

test('dynamic interactions appear only after inspection, exact friend authorship and separate opt-ins',()=>{
 const off=menu([inspected])
 assert.equal(off.some(x=>x.action==='like_shared_dynamic'),false)
 const on=menu([inspected],{sharedDynamicLikeEnabled:true,sharedDynamicCommentEnabled:true})
 assert.equal(on.some(x=>x.action==='like_shared_dynamic'&&x.ids.includes(id)),true)
 assert.equal(on.some(x=>x.action==='comment_shared_dynamic'&&x.ids.includes(id)),true)
 assert.equal(__test.validateOfferedLifeAction({action:'comment_shared_dynamic',id,reason:'这道菜看起来很用心',text:'这盘菜看着很香，颜色搭配也好舒服！'},on),true)
 assert.equal(__test.validateOfferedLifeAction({action:'comment_shared_dynamic',id,reason:'这道菜看起来很用心',text:'@someone https://evil.example'},on),false)
 assert.equal(__test.validateOfferedLifeAction({action:'like_shared_dynamic',id,reason:'我真心喜欢这条动态'},on),true)
 assert.equal(__test.validateOfferedLifeAction({action:'like_shared_dynamic',id,reason:'hi'},on),false)
})

test('dynamic authored by another person never gets write options',()=>{
 const other={...inspected,authorMatchesSharer:false}
 const offered=menu([other],{sharedDynamicLikeEnabled:true,sharedDynamicCommentEnabled:true})
 assert.equal(offered.some(x=>['like_shared_dynamic','comment_shared_dynamic'].includes(x.action)),false)
})

test('dynamic without readable text or image evidence does not get public-write options',()=>{
 const unknown={...inspected,summary:'',imageObservations:[]}
 const offered=menu([unknown],{sharedDynamicLikeEnabled:true,sharedDynamicCommentEnabled:true})
 assert.equal(offered.some(x=>['like_shared_dynamic','comment_shared_dynamic'].includes(x.action)),false)
})

test('Bilibili short-link resolution is only invoked after Life chooses inspect_shared_link',async()=>{
 const {readFileSync}=await import('node:fs')
 const host=readFileSync('index.js','utf8'),planner=readFileSync('lib/autonomous-planner.mjs','utf8')
 const onIncoming=host.slice(host.indexOf('onIncoming:async'),host.indexOf('generateReply: async',host.indexOf('onIncoming:async')))
 const readFn=host.slice(host.indexOf('const executeSharedBiliLinkRead='),host.indexOf('const recordSharedBiliLinkFailure='))
 const branch=planner.slice(planner.indexOf("outcome.action==='inspect_shared_link'"),planner.indexOf("outcome.action==='like_shared_dynamic'"))
 assert.match(onIncoming,/offerPrivateBiliLinkToLife/)
 assert.doesNotMatch(onIncoming,/resolveBiliShareLink|bili_dynamic_info|bili_video_info_by_aid/)
 assert.match(readFn,/resolveBiliShareLink/)
 assert.match(branch,/executeSharedBiliLinkRead/)
})
