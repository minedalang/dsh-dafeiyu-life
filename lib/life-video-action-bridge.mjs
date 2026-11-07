/**
 * Process-local Life approval for autonomous Python video Agent writes.
 * The Python MCP never receives a reusable platform grant: every proposed
 * write requires its own account-bound Life choice and existing Python guards.
 */
import {createServer} from 'node:http'
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
const KIND={bili_video_like:'video_like',bili_video_collect:'video_collect',
  bili_follow_creator:'video_follow',bili_unfollow_creator:'video_unfollow',
  bili_favorite_folder_delete:'video_folder_delete',bili_reply:'video_comment'}
const VIDEO=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const LABEL={video_like:'给确实挑中的公开视频点赞',video_collect:'收藏想以后再看的公开视频',
  video_follow:'关注多次遇见的公开视频作者',video_unfollow:'经过核实后取关原来自主关注的作者',
  video_folder_delete:'删除已经确认不再需要的自建收藏夹',video_comment:'对入选公开视频发表顶层原创评论'}
export function createLifeVideoActionBridge({getAccountUid,getAccountTag,choose,verify,receipt,enabled=()=>true,now=Date.now}={}){
  if(typeof getAccountUid!=='function'||typeof getAccountTag!=='function'||typeof choose!=='function'||
     typeof verify!=='function'||typeof receipt!=='function')throw TypeError('Life 视频写入网关缺少依赖')
  const secret=randomBytes(32).toString('hex'),pending=new Map()
  let server=null,port=0,closed=false
  const deny=(res,code,reason)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({ok:false,reason}))}
  const safeAccount=()=>{try{return enabled()===true&&UID.test(String(getAccountUid()||''))&&/^[a-f0-9]{16}$/.test(String(getAccountTag()||''))}catch{return false}}
  function expire(){for(const [id,p] of pending)if(p.until<now()||p.scope!==getAccountTag()){
    pending.delete(id);try{receipt(p.proof,{status:'uncertain'})}catch{}
  }}
  const handler=async(req,res)=>{
    if(req.method!=='POST'||!['/life-action','/life-action-result'].includes(req.url||''))return deny(res,404,'not-found')
    const raw=String(req.headers.authorization||'').replace(/^Bearer /,'')
    const x=Buffer.from(raw),y=Buffer.from(secret)
    if(x.length!==y.length||!timingSafeEqual(x,y))return deny(res,403,'unauthorized-video-agent')
    let input=''
    try{for await(const chunk of req){input+=chunk;if(Buffer.byteLength(input)>2048)throw Error('too-large')}
      const body=JSON.parse(input)
      if(!safeAccount()||String(body.uid||'')!==String(getAccountUid()))return deny(res,409,'account-not-ready')
      expire()
      if(req.url==='/life-action-result'){
        const p=pending.get(String(body.grant||''))
        if(!p||p.uid!==String(body.uid)||p.scope!==getAccountTag())return deny(res,409,'approval-not-current')
        pending.delete(body.grant)
        // Python tool result is a self-report, not an independently verified
        // Bilibili read-after-write receipt; never label it verified.
        const status=body.ok===true?'accepted-unverified':'uncertain'
        receipt(p.proof,{status})
        res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,status}))
      }
      const kind=KIND[body.tool],target=String(body.target||'')
      if(!kind||!(kind==='video_unfollow'||kind==='video_folder_delete'?UID:VIDEO).test(target))return deny(res,400,'invalid-video-action')
      const label=LABEL[kind],reason=String(body.reason||'').slice(0,100).replace(/[\x00-\x1f\x7f]/g,' ')
      const choice=await choose({trigger:'video-agent-write',scene:'video-agent',
        sourceKey:`video-tool:${kind}:${target}:${randomUUID()}`,
        candidates:[{id:'choose_'+kind,kind,label}],hint:reason})
      if(choice?.ok!==true||verify(choice.proof,kind)?.ok!==true)return deny(res,409,'life-declined-video-action')
      if(!safeAccount()||String(body.uid)!==String(getAccountUid())){
        receipt(choice.proof,{status:'not-sent'});return deny(res,409,'account-changed')
      }
      const grant=randomUUID();pending.set(grant,{proof:choice.proof,uid:String(body.uid),scope:getAccountTag(),until:now()+90_000})
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'})
      res.end(JSON.stringify({ok:true,grant,ttlSeconds:90}))
    }catch{return deny(res,409,'life-video-gateway-unavailable')}
  }
  return {
    async start(){if(closed)throw Error('video-bridge-closed');if(server)return port
      const s=createServer((req,res)=>{void handler(req,res)})
      try{await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)})}
      catch(e){s.close();throw e}
      // Do not keep a simulated host alive if it forgets to dispose.
      s.unref?.()
      server=s;port=s.address().port;return port
    },
    env(){return server&&port&&!closed?{BILI_LIFE_ACTION_URL:`http://127.0.0.1:${port}`,BILI_LIFE_ACTION_TOKEN:secret}:{}},
    status(){return {ready:!!server&&!!port&&!closed,pending:pending.size}},
    stop(){closed=true;for(const p of pending.values())try{receipt(p.proof,{status:'uncertain'})}catch{}
      pending.clear();const s=server;server=null;port=0;s?.close()}
  }
}
