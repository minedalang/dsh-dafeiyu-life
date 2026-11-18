import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createNotificationSentinelState} from '../lib/notification-sentinel-state.mjs'

const dm=(followUnread=0)=>({followUnread,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0})
const social=(replyCount=0,atCount=0,likeCount=0)=>({mode:'split',replyCount,atCount,replyAtTotal:replyCount+atCount,likeCount})
function fixture(){const dir=mkdtempSync(join(tmpdir(),'bili-sentinel-state-'));let now=1_800_000_000_000;const tag='0123456789abcdef'
  return {dir,tag,get now(){return now},advance(ms){now+=ms},create:()=>createNotificationSentinelState({dataDir:dir,getAccountTag:()=>tag,now:()=>now})}}

test('未读计数首次建立安全基线，之后只对增加触发详情读取',()=>{
  const f=fixture();try{const s=f.create()
    assert.equal(s.recordDm(dm()).first,true);assert.equal(s.status().dm.pending,true)
    s.markDmDetailSuccess();assert.equal(s.status().dm.pending,false)
    assert.equal(s.recordDm(dm()).increased,false);assert.equal(s.status().dm.pending,false)
    assert.equal(s.recordDm(dm(1)).increased,true);assert.equal(s.status().dm.pending,true)
    s.markDmDetailSuccess();s.recordDm(dm(0));assert.equal(s.status().dm.pending,false)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})

test('互动计数按回复、@、点赞分类识别，聚合字段变化时双类别核对',()=>{
  const f=fixture();try{const s=f.create()
    s.recordSocial(social());assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),['replies','mentions'])
    s.markSocialDetailSuccess(['replies','mentions'])
    s.recordSocial(social(1,0,0));assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),['replies'])
    s.markSocialDetailSuccess(['replies'])
    s.recordSocial(social(1,1,0));assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),['mentions'])
    s.markSocialDetailSuccess(['mentions'])
    s.recordSocial(social(1,1,1));assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),['mentions'])
    s.markSocialDetailSuccess(['mentions'])
    s.recordSocial({mode:'combined',replyCount:null,atCount:null,replyAtTotal:3,likeCount:1})
    assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),['replies','mentions'])
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})

test('计数下降只更新基准；30 分钟一致性核对会重新安排详情读取',()=>{
  const f=fixture();try{const s=f.create()
    s.recordDm(dm(3));s.markDmDetailSuccess();s.recordSocial(social(2,1,4));s.markSocialDetailSuccess(['replies','mentions'])
    s.recordDm(dm(1));s.recordSocial(social(1,0,2))
    assert.equal(s.status().dm.pending,false);assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),[])
    f.advance(30*60_000);s.requestReconciliation({dmEnabled:true,repliesEnabled:true,mentionsEnabled:true})
    assert.equal(s.status().dm.pending,true)
    assert.deepEqual(s.pendingSocialCategories({repliesEnabled:true,mentionsEnabled:true}),['replies','mentions'])
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})

test('计数快照跨重启持久化并按账号作用域隔离，不存消息正文或 UID',()=>{
  const f=fixture();try{const s=f.create();s.recordDm(dm(2));s.recordSocial(social(2,1,0))
    const file=s.fileForCurrentAccount(),raw=readFileSync(file,'utf8'),again=f.create()
    assert.equal(again.status().dm.snapshot.followUnread,2)
    assert.deepEqual(again.status().social.snapshot,{mode:'split',replyCount:2,atCount:1,replyAtTotal:3,likeCount:0})
    assert.doesNotMatch(raw,/message|uid|sessdata|cookie|text/i)
    const other=createNotificationSentinelState({dataDir:f.dir,getAccountTag:()=> 'fedcba9876543210',now:()=>f.now})
    assert.equal(other.status().dm.snapshot,null)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})

test('损坏账本 fail closed，不会自动清空或重新建立零计数基准',()=>{
  const f=fixture();try{const s=f.create();const file=s.fileForCurrentAccount();writeFileSync(file,'{broken','utf8')
    assert.throws(()=>s.status(),/账本格式异常/)
    assert.equal(readFileSync(file,'utf8'),'{broken')
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})
