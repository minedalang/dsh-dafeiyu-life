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
const RECEIPT_ID=/^[1-9]\d{0,29}$/
const LABEL={video_like:'给确实挑中的公开视频点赞',video_collect:'收藏想以后再看的公开视频',
  video_follow:'关注多次遇见的公开视频作者',video_unfollow:'经过核实后取关原来自主关注的作者',
  video_folder_delete:'删除已经确认不再需要的自建收藏夹',video_comment:'对入选公开视频发表顶层原创评论'}
export function createLifeVideoActionBridge({getAccountUid,getAccountTag,choose,verify,receipt,verifyPlatformState=async()=>false,enabled=()=>true,onCommentDiagnostic=()=>{},onCommentReview=()=>({ok:false}),onVerifiedAction=()=>{},now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(typeof getAccountUid!=='function'||typeof getAccountTag!=='function'||typeof choose!=='function'||
     typeof verify!=='function'||typeof receipt!=='function')throw TypeError('Life 视频写入网关缺少依赖')
  const secret=randomBytes(32).toString('hex'),pending=new Map()
  // Account-scoped anonymous counters belong to the existing video-round journal.
  // Never emit BV, UID, text, model prose or raw provider errors here.
  const note=(stage,code='')=>{try{onCommentDiagnostic({stage,code})}catch{}}
  let server=null,port=0,closed=false
  const deny=(res,code,reason)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({ok:false,reason}))}
  const safeAccount=()=>{try{return enabled()===true&&UID.test(String(getAccountUid()||''))&&/^[a-f0-9]{16}$/.test(String(getAccountTag()||''))}catch{return false}}
  function expire(){for(const [id,p] of pending)if(p.until<now()||p.scope!==getAccountTag()){
    pending.delete(id);try{receipt(p.proof,{status:'uncertain'})}catch{}
  }}
  const handler=async(req,res)=>{
    if(req.method!=='POST'||!['/life-action','/life-action-result','/life-comment-review'].includes(req.url||''))return deny(res,404,'not-found')
    const raw=String(req.headers.authorization||'').replace(/^Bearer /,'')
    const x=Buffer.from(raw),y=Buffer.from(secret)
    if(x.length!==y.length||!timingSafeEqual(x,y))return deny(res,403,'unauthorized-video-agent')
    let input=''
    try{for await(const chunk of req){input+=chunk;if(Buffer.byteLength(input)>8192)throw Error('too-large')}
      const body=JSON.parse(input)
      if(!safeAccount()||String(body.uid||'')!==String(getAccountUid()))return deny(res,409,'account-not-ready')
      const scopeAtProposal=getAccountTag()
      expire()
      if(req.url==='/life-comment-review'){
        // Read-only model consideration: never grants a platform write.
        // The host validates the active round and canonical picked ledger.
        if(!/^[a-f0-9]{24}$/.test(String(body.roundId||''))||
          !VIDEO.test(String(body.bvid||''))||
          !['want','pass','insufficient'].includes(body.decision))return deny(res,400,'invalid-comment-review')
        const accepted=onCommentReview({roundId:body.roundId,bvid:body.bvid,decision:body.decision})
        if(accepted?.ok!==true){
          const reasons=new Set(['comment-review-not-current','comment-selection-not-confirmed',
            'comment-review-already-recorded','comment-review-permission-unavailable'])
          const reason=reasons.has(accepted?.reason)?accepted.reason:'comment-review-not-current'
          note('review-rejected',reason);return deny(res,409,reason)
        }
        res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'})
        return res.end(JSON.stringify({ok:true,recorded:true}))
      }
      if(req.url==='/life-action-result'){
        const p=pending.get(String(body.grant||''))
        if(!p||p.uid!==String(body.uid)||p.scope!==getAccountTag())return deny(res,409,'approval-not-current')
        pending.delete(body.grant)
        // The Python writer's success boolean NEVER verifies its own result.
        // A fresh, host-initiated read-only query must match the exact target,
        // action and still-current account. Unknown/failed reads stay frozen.
        let status=body.ok===true?'accepted-unverified':'uncertain'
        if(body.ok===true&&['video_like','video_collect','video_follow','video_unfollow','video_comment'].includes(p.kind)&&
          (p.kind!=='video_comment'||RECEIPT_ID.test(String(body.receiptId||'')))){
          try{
            if(safeAccount()&&p.scope===getAccountTag()&&
              await verifyPlatformState({kind:p.kind,target:p.target,uid:p.uid,scope:p.scope,
                ...(p.kind==='video_comment'?{receiptId:String(body.receiptId),commentText:p.commentText}: {})})===true&&
              safeAccount()&&p.scope===getAccountTag())status='verified'
          }catch{/* verification is read-only and fail-closed */}
        }
        receipt(p.proof,{status})
        // Inform Life memory only after an independent read-after-write check.
        // Never turn the Python writer's own success flag into an episode.
        let memoryQueued=null
        if(status==='verified')try{
          const accepted=await onVerifiedAction({kind:p.kind,target:p.target,
            scope:p.scope,sourceId:p.proof.id,at:now()})
          memoryQueued=accepted?.ok===true||(Number.isSafeInteger(accepted?.pending)&&accepted.pending>0)
        }catch{memoryQueued=false}
        // Report memory projection separately. Never change verified platform
        // status, never retry an already-attempted platform write.
        // The original Life coordinator is the only durable memory outbox.
        if(p.kind==='video_comment')note(status==='verified'?'verified':'unverified',status)
        res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,status,...(status==='verified'?{memoryQueued}: {})}))
      }
      const kind=KIND[body.tool],target=String(body.target||'')
      if(!kind||!(kind==='video_unfollow'||kind==='video_folder_delete'?UID:VIDEO).test(target))return deny(res,400,'invalid-video-action')
      // Only approve a top-level video comment with exact text bound to the
      // short-lived grant. No text is ever stored in the persistent Life ledger.
      if(kind==='video_comment'&&(body.topLevel!==true||typeof body.commentText!=='string'||
        body.commentText.length<1||body.commentText.length>2000||/[\u0000-\u0008\u000e-\u001f]/.test(body.commentText)))
        return deny(res,400,'invalid-comment-proof')
      if(kind==='video_comment')note('proposed')
      const label=LABEL[kind],reason=String(body.reason||'').slice(0,100).replace(/[\x00-\x1f\x7f]/g,' ')
      const sourceKey=`video-tool:${kind}:${target}:${randomUUID()}`
      // Life identity projection accepts a bounded scene vocabulary. A video
      // writer is an execution producer, not a persona scene: public comments
      // use the existing comment context, other video actions use main.
      // Passing 'video-agent' here always fails Life's base identity fallback.
      const decisionInput={trigger:'video-agent-write',scene:kind==='video_comment'?'comment':'main',sourceKey,
        candidates:[{id:'choose_'+kind,kind,label}],hint:reason}
      let choice=await choose(decisionInput)
      // A recent verified action can create a short cross-channel rest window.
      // No platform write has started at this point, so a single bounded Life
      // re-consideration after the known notBefore is safe. Unknown/in-flight
      // admissions are never retried here.
      if(kind==='video_comment'&&choice?.ok!==true&&choice?.reason==='life-cross-channel-rest'&&
        Number.isSafeInteger(choice.notBefore)){
        const waitMs=choice.notBefore-now()
        if(waitMs<=0||waitMs<=35_000){
          if(waitMs>0)await sleep(waitMs+100)
          if(safeAccount()&&getAccountTag()===scopeAtProposal&&String(body.uid)===String(getAccountUid())&&
            !res.destroyed&&now()>=choice.notBefore){
            choice=await choose({...decisionInput,sourceKey:sourceKey+':after-cooldown'})
          }
        }
      }
      const proofValid=choice?.ok===true&&verify(choice.proof,kind)?.ok===true
      if(!proofValid){
        const technicalCodes=['life-not-ready','unverified-life-candidate','invalid-life-candidate','trace-unavailable',
          'life-context-unavailable','life-account-changed','planner-budget-incompatible','life-willingness-quota',
          'life-willingness-unavailable','life-choice-in-progress','life-cross-channel-rest','life-admission-unavailable',
          'life-opportunity-window-full','life-choice-expired','life-choice-claim-lost','life-admission-approval-failed',
          'life-choice-review-required','life-account-unavailable','life-choice-deferred','life-opportunity-deferred']
        const reason=choice?.ok===true?'life-choice-review-required':
          choice?.action==='defer'?(choice.reason==='another-life-opportunity-chosen'?'life-opportunity-deferred':'life-choice-deferred'):
          technicalCodes.includes(choice?.reason)?choice.reason:'life-declined-video-action'
        if(kind==='video_comment')note(reason==='life-declined-video-action'?'declined':
          ['life-choice-deferred','life-opportunity-deferred'].includes(reason)?'deferred':'blocked',reason)
        // Rejection remains fail-closed. Only a bounded reason code is sent;
        // no grant or model/provider output is exposed to the subprocess.
        return deny(res,409,reason)
      }
      if(!safeAccount()||getAccountTag()!==scopeAtProposal||String(body.uid)!==String(getAccountUid())){
        receipt(choice.proof,{status:'not-sent'});return deny(res,409,'account-changed')
      }
      if(kind==='video_comment')note('approved')
      const grant=randomUUID();pending.set(grant,{proof:choice.proof,kind,target,uid:String(body.uid),scope:getAccountTag(),
        ...(kind==='video_comment'?{commentText:body.commentText}:{}),until:now()+90_000})
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
