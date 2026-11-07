import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createLiveLifeActivity} from '../lib/live-life-activity.mjs'
import {verifiedBiliImageUrl,extractBiliPicture,readBiliImageForModel,describeIncomingBiliImage} from '../lib/incoming-image-vision.mjs'
import {collectDmInbox} from '../lib/dm-inbox.mjs'
import {normalizeReplyNotifications,normalizeTopComments} from '../lib/comment-inbox.mjs'
import {runHostModelText} from '../lib/host-model-call.mjs'
import {createCommentVideoContext} from '../lib/comment-video-context.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const url='https://i0.hdslb.com/bfs/new_dyn/abc123456.jpeg'
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(128)])
const response=()=>new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}})

test('正在进行中的动作是按账号、进程和真实结束来展示，不伪造发送成功',()=>{
 let tick=1760000000000
 const tracker=createLiveLifeActivity({now:()=>tick})
 const stop=tracker.start('comment','aaaaaaaaaaaaaaaa')
 assert.equal(tracker.snapshot('aaaaaaaaaaaaaaaa').active[0].kind,'comment')
 assert.equal(tracker.snapshot('bbbbbbbbbbbbbbbb').active.length,0)
 stop();stop()
 assert.equal(tracker.snapshot('aaaaaaaaaaaaaaaa').live,false)
 assert.equal(tracker.snapshot('aaaaaaaaaaaaaaaa').recent.length,1)
 assert.equal(tracker.snapshot('bbbbbbbbbbbbbbbb').recent.length,0)
 assert.match(tracker.snapshot('aaaaaaaaaaaaaaaa').recent[0].text,/未核实发表/)
 tracker.start('video','aaaaaaaaaaaaaaaa',{maxAgeMs:1000})
 tick+=1001
 assert.equal(tracker.snapshot('aaaaaaaaaaaaaaaa').active.length,0,'失联的进程标记不能永远显示运行中')
 assert.equal(tracker.snapshot('').recent.length,0)
})
test('图片 URL 只允许受控的 B站 HTTPS 图片 CDN，不跟随用户链接',()=>{
 for(const bad of ['http://i0.hdslb.com/bfs/a','https://i0.hdslb.com.evil.test/bfs/a','https://api.bilibili.com/x/web-interface','https://127.0.0.1/bfs/a','file:///x','https://user@i0.hdslb.com/bfs/a','https://i0.hdslb.com/public/a','https://i0.hdslb.com/bfs/a#frag'])assert.equal(verifiedBiliImageUrl(bad),'',bad)
 assert.equal(verifiedBiliImageUrl('//i0.hdslb.com/bfs/new_dyn/abc.jpeg'),url.replace('abc123456.jpeg','abc.jpeg'))
 assert.equal(extractBiliPicture({pictures:[{img_src:url}]}),url)
 assert.equal(extractBiliPicture({image:{url}}),url)
})
test('图片下载在发起模型请求前核验 HTTP 类型、实际文件头与硬尺寸限制',async()=>{
 let calls=0
 const fetchImpl=async(current,options)=>{calls++;assert.equal(current,url);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return response()}
 const result=await readBiliImageForModel(url,{fetchImpl});assert.equal(result.mimeType,'image/png');assert.ok(result.data.length>100);assert.equal(calls,1)
 await assert.rejects(readBiliImageForModel('http://127.0.0.1/secret',{fetchImpl}),/来源未核验/)
 assert.equal(calls,1)
 await assert.rejects(readBiliImageForModel(url,{fetchImpl:async()=>new Response('<html>hello</html>',{headers:{'content-type':'text/html'}})}),/图片格式/)
 await assert.rejects(readBiliImageForModel(url,{fetchImpl:async()=>new Response(Buffer.from('x'.repeat(200)),{headers:{'content-type':'image/png'}})}),/类型与内容不符/)
 await assert.rejects(readBiliImageForModel(url,{maxBytes:64,fetchImpl}),/超过大小限制/)
})
test('图片只有宿主模型真实完成多模态请求才产生观察；无工具调用',async()=>{
 const calls=[]
 const llm={listProviders:()=>[{id:'mock'}],async *stream(request){calls.push(request);yield {type:'text-delta',text:'画面里有一条蓝色的鱼。'};yield {type:'finish',reason:{kind:'stop'}}}}
 const description=await describeIncomingBiliImage({url,llm,selection:{provider:'mock',model:'vision'},fetchImpl:async()=>response()})
 assert.equal(description,'画面里有一条蓝色的鱼。')
 assert.equal(calls[0].tools.length,0)
 assert.equal(calls[0].messages[0].content[1].type,'image')
 assert.equal(calls[0].messages[0].content[1].mimeType,'image/png')
 assert.equal(calls[0].messages[0].content[1].data,png.toString('base64'))
 const refusing={listProviders:()=>[{id:'mock'}],async *stream(){yield {type:'tool-call-delta',text:'x'}}}
 await assert.rejects(describeIncomingBiliImage({url,llm:refusing,selection:{provider:'mock',model:'vision'},fetchImpl:async()=>response()}),/工具调用/)
})
test('实际收到的图片私信在暂存收件箱中保留受控图片信息，错误链接不入账',async()=>{
 const rows=await collectDmInbox({sessions:[{uid:'123',unread:1,lastTs:1760000000}],ownUid:99,
   now:()=>1760000000000,readConversation:async()=>[{key:'abc',ts:1760000000,fromMe:false,kind:2,text:'[收到图片]',imageUrl:url}],onRead:()=>{}})
 assert.equal(rows.length,1);assert.equal(rows[0].imageUrl,url);assert.equal(rows[0].system,false)
 const rejected=await collectDmInbox({sessions:[{uid:'123',unread:1,lastTs:1760000000}],ownUid:99,
   now:()=>1760000000000,readConversation:async()=>[{key:'abc',ts:1760000000,fromMe:false,kind:2,text:'[收到图片]',imageUrl:'http://127.0.0.1/abc'}]})
 assert.equal(rejected.length,1);assert.equal('imageUrl' in rejected[0],false)
})
test('公开视频评论图片随原始评论定位，不凭陌生人文字生成图片',()=>{
 const notification={data:{items:[{item:{source_id:'999',subject_id:'42',root_id:'0',business:'视频',source_content:'请看这个',source_pictures:[{img_src:url}],source_time:1760000000},user:{mid:'123',uname:'用户'}}]}}
 const rows=normalizeReplyNotifications(notification,'99')
 assert.equal(rows.length,1);assert.equal(rows[0].imageUrl,url)
 const top=normalizeTopComments({comments:[{mid:'123',rpid:'999',content:'',pictures:[{img_src:url}]}]},'BV1abcde1234','99')
 assert.equal(top.length,1);assert.equal(top[0].imageUrl,url)
})
test('图片-only 评论在按 root_id 核验 UID/rpid 后可获得图片来源，陌生 UID 不能冒领',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rc-life-photo-comment-'))
 try{
  const ctx=createCommentVideoContext({stateDir:dir,getInfo:async()=>({title:'公开作品'}),getHot:async()=>({comments:[]}),
   getSubtitle:async()=>({}),getThread:async()=>({root_comment:{rpid:'888',mid:'123',content:'',pictures:[{img_src:url}]},replies:[]})})
  const good=await ctx.forReply('BV1abcde1234',{root:'888',rpid:'888',uid:'123',text:'[收到图片]',includeHot:false})
  assert.equal(good.imageUrl,url)
  const spoof=await ctx.forReply('BV1abcde1234',{root:'888',rpid:'888',uid:'999',text:'[收到图片]',includeHot:false})
  assert.equal(spoof.imageUrl,'')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('统一界面只有一份实时 Life、待办、情绪入口，生活方案有独立自定义卡',()=>{
 const html=source('lib/management-console.html'),js=source('lib/management-console.js'),index=source('index.js')
 assert.match(html,/data-tab="life-agent"[^>]*>🐟 鱼鱼此刻/)
 assert.doesNotMatch(html,/data-tab="todos"/)
 for(const id of ['life-now-title','life-now-detail','life-now-recent','life-todo-section','life-emotion-section','life-organic-profile','bili-disable-incoming-vision'])assert.equal(html.split(`id="${id}"`).length-1,1,id)
 for(const option of ['gentle','balanced','curious','custom'])assert.match(html,new RegExp('name="life-organic-choice" value="'+option+'"'))
 assert.doesNotMatch(html,/id="quota-fields-pick"|id="bili-pick-per-round"|id="bili-per-day"/)
 assert.match(html,/prefers-reduced-motion:reduce/)
 assert.match(js,/\/live-activity/)
 assert.match(index,/incomingImageRecognitionEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(index,/agentFollowEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(js,/if\(tab==='todos'\)tab='life-agent'/)
})
