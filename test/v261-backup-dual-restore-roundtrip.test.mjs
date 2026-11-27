import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  createLifeMemoryBackup, inspectLifeMemoryBackup, restoreLifeMemoryBackup,
  createBackup, validateBackup, restoreBackupFiles, planBusinessRestore, previewBusinessLifeRestore, businessRestorePreview, backupMemoryOverview, memoryRepairSource, previewPortableMemoryRepair, planPortableMemoryRepair, repairPortableMemoryDetails,
} from '../lib/data-backup.mjs'
import { saveBackupJson } from '../lib/backup-directory.mjs'
import {createLifeMemoryDetailStore} from '../lib/life-memory-details.mjs'
import { readJsonRequest } from '../lib/http-json-body.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dual-restore-'))
const put=(root,name,value)=>{
  const file=join(root,...name.split('/'))
  mkdirSync(join(file,'..'),{recursive:true})
  writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n','utf8')
}
const candidate=i=>({
  id:'c-'+i.toString(16).padStart(18,'0'),key:`comment:dynamic:123456789012345:${i+10000}`,
  kind:'comment',contentType:'dynamic',bvid:'',dynamicId:'123456789012345',
  status:'pending',memoryIds:[],day:'2026-11-02',title:'鱼鱼在动态评论里的真实经历 🌻',
  text:'来自观众的真实文字：我想了解怎样做视频，看看方大同的歌 🎵🐟',
})
const makeLifeFixture=root=>{
  const candidates=Array.from({length:85},(_,i)=>candidate(i))
  put(root,'life-memory/candidates.json',{version:1,candidates,runs:[],lastReflectionAt:0,lastError:''})
  put(root,'life-memory/episodic.json',{
    version:1,episodes:[{id:'ep-demo',kind:'watch',stage:'clear',text:'曾了解方大同的作品 🎵',at:1772450000000}],
    archiveKeys:[],updatedAt:1772450000000,
  })
  put(root,'long-term-memory/dafeiyu.json',{
    version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[],migration:{legacySessionFiles:[]},
  })
  put(root,'life-memory/archive/2026-11.jsonl',JSON.stringify({version:1,id:'event-one',event:{kind:'watch',text:'研究视频制作：Pillow + FFmpeg 💜'}})+'\n')
  return {candidates}
}
function chunksAroundUtf8(payload,needle){
  const at=payload.indexOf(Buffer.from(needle,'utf8'))
  assert.ok(at>1,`必须在载荷中找到 ${needle}`)
  return [payload.subarray(0,at+1),payload.subarray(at+1,at+2),payload.subarray(at+2)]
}
async function postBody(payload,chunks,strict=true){
  const req=new PassThrough()
  const result=readJsonRequest(req,65_000_000,{strict})
  for(const chunk of chunks)req.write(chunk)
  req.end()
  return result
}
const serialized=(data,confirmation)=>Buffer.from(JSON.stringify({backup:data,confirm:confirmation}),'utf8')
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')

test('专项人生记忆：当前数据含动态评论候选时，导出→落盘→上传碎片→校验→恢复全链路无损',async()=>{
  const source=temp(),folder=temp(),dest=temp()
  try{
    const original=makeLifeFixture(source)
    const bundle=createLifeMemoryBackup(source)
    assert.equal(inspectLifeMemoryBackup(bundle).integrity,'sha256-verified')
    assert.equal(bundle.files['life-memory/private-insights.json'],undefined)
    const filepath=saveBackupJson(folder,bundle,'dafeiyu-memory')
    const disk=JSON.parse(readFileSync(filepath,'utf8'))
    const buf=serialized(disk,'RESTORE_DAFEIYU_MEMORY')
    for(const needle of ['鱼鱼','真实经历','🎵','🐟','FFmpeg','🌻']){
      const parsed=await postBody(buf,chunksAroundUtf8(buf,needle))
      assert.equal(inspectLifeMemoryBackup(parsed.backup).integrity,'sha256-verified')
      assert.equal(parsed.backup.files['life-memory/candidates.json'],bundle.files['life-memory/candidates.json'])
    }
    const little=[]
    for(let i=0;i<buf.length;i+=97)little.push(buf.subarray(i,i+97))
    const parsed=await postBody(buf,little)
    const snapshot=saveBackupJson(folder,createLifeMemoryBackup(dest),'pre-memory-restore')
    assert.ok(existsSync(snapshot))
    assert.equal(restoreLifeMemoryBackup(dest,parsed.backup),Object.keys(bundle.files).length)
    assert.deepEqual(JSON.parse(readFileSync(join(dest,'life-memory/candidates.json'),'utf8')).candidates,original.candidates)
    assert.equal(readFileSync(join(dest,'life-memory/candidates.json'),'utf8'),bundle.files['life-memory/candidates.json'])
    assert.equal(readFileSync(join(dest,'life-memory/archive/2026-11.jsonl'),'utf8'),bundle.files['life-memory/archive/2026-11.jsonl'])
  }finally{for(const dir of [source,folder,dest])rmSync(dir,{recursive:true,force:true})}
})

test('旧版记忆备份 schema2 / 无新角色身份：严格 HTTP 上传后可校验并恢复，不要求额外账号',async()=>{
  const folder=temp(),target=temp()
  try{
    put(folder,'life-memory/episodic.json',{version:1,episodes:[],archiveKeys:[],updatedAt:0})
    put(folder,'long-term-memory/dafeiyu.json',{version:2,memories:[],traces:[],deleted:[]})
    const bundle=createLifeMemoryBackup(folder)
    const disk=JSON.parse(readFileSync(saveBackupJson(folder,bundle,'dafeiyu-memory'),'utf8'))
    assert.ok(!JSON.stringify(disk).includes('character-identity.json'))
    const buf=serialized(disk,'RESTORE_DAFEIYU_MEMORY')
    const parsed=await postBody(buf,[buf.subarray(0,1),buf.subarray(1,18),buf.subarray(18)])
    assert.equal(inspectLifeMemoryBackup(parsed.backup).integrity,'sha256-verified')
    restoreLifeMemoryBackup(target,parsed.backup)
    assert.deepEqual(JSON.parse(readFileSync(join(target,'long-term-memory/dafeiyu.json'),'utf8')).memories,[])
  }finally{for(const dir of [folder,target])rmSync(dir,{recursive:true,force:true})}
})

test('专项备份篡改候选和非法路径必须拒绝，绝不改动正在使用的原记忆',async()=>{
  const folder=temp(),target=temp()
  try{
    makeLifeFixture(folder)
    const bundle=createLifeMemoryBackup(folder)
    put(target,'life-memory/candidates.json','现在的真实人生记忆，不允许覆盖')
    const tampered=structuredClone(bundle)
    tampered.files['life-memory/candidates.json']=tampered.files['life-memory/candidates.json'].replace('真实经历','未验证经历')
    assert.throws(()=>restoreLifeMemoryBackup(target,tampered),/记忆备份文件篡改或路径非法：life-memory\/candidates\.json/)
    const unsafe=structuredClone(bundle)
    unsafe.files['life-memory/../bili_credential.json']='cookie'
    unsafe.hashes['life-memory/../bili_credential.json']=sha('cookie')
    assert.throws(()=>restoreLifeMemoryBackup(target,unsafe),/文件篡改或路径非法/)
    assert.equal(readFileSync(join(target,'life-memory/candidates.json'),'utf8'),'现在的真实人生记忆，不允许覆盖')
  }finally{for(const dir of [folder,target])rmSync(dir,{recursive:true,force:true})}
})

test('恢复时不应让更早备份使已衰减的经历重新变清晰',()=>{
  const folder=temp(),target=temp()
  try{
    makeLifeFixture(folder)
    const saved=createLifeMemoryBackup(folder)
    put(target,'life-memory/episodic.json',{
      version:1,episodes:[{id:'ep-demo',kind:'watch',stage:'trace',text:'一段模糊的经历',at:1772450000000}],archiveKeys:[],updatedAt:1772450000000,
    })
    restoreLifeMemoryBackup(target,saved)
    const after=JSON.parse(readFileSync(join(target,'life-memory/episodic.json'),'utf8'))
    assert.equal(after.episodes[0].stage,'trace')
    assert.equal(after.episodes[0].text,'一段模糊的经历')
  }finally{for(const dir of [folder,target])rmSync(dir,{recursive:true,force:true})}
})

test('大备份：旧用户 seen.md 与专项候选可同时存在；两种恢复使用同一严格读取器',async()=>{
  const root=temp(),dest=temp()
  try{
    makeLifeFixture(root)
    put(root,'seen.md','鱼鱼曾经通过观看资料了解世界\r\n方大同歌曲 🎵🐟\r\n')
    const whole=createBackup({root,config:{},sqlite:{},version:'2.6.1'})
    const buf=serialized(whole,'RESTORE_VERIFIED_DATA')
    const parsed=await postBody(buf,chunksAroundUtf8(buf,'方大同'))
    assert.equal(validateBackup(parsed.backup).integrity,'sha256-verified')
    restoreBackupFiles(dest,parsed.backup)
    assert.equal(readFileSync(join(dest,'seen.md'),'utf8'),whole.files['seen.md'])
    assert.equal(readFileSync(join(dest,'life-memory/candidates.json'),'utf8'),whole.files['life-memory/candidates.json'])
    const server=fileURLToPath(new URL('../index.js',import.meta.url))
    const code=readFileSync(server,'utf8')
    assert.match(code,/const readBackupBody = \(req, maxBytes\) => readJsonRequest\(req, maxBytes, \{strict:true\}\)/)
    assert.match(code,/const body = await readBackupBody\(req, 320_000_000\)/)
    assert.match(code,/const body=await readBackupBody\(req,320_000_000\),source=body\?\.backup/)
  }finally{for(const dir of [root,dest])rmSync(dir,{recursive:true,force:true})}
})

test('严格上传：无效 UTF-8、截断 JSON、空载荷、超长载荷都有清晰拒绝原因',async()=>{
  await assert.rejects(postBody(null,[Buffer.from([0x7b,0x22,0xe9,0x7d])]),/UTF-8/)
  await assert.rejects(postBody(null,[Buffer.from('{"backup":')]),/备份 JSON 无法解析/)
  await assert.rejects(postBody(null,[]),/备份上传内容为空/)
  const req=new PassThrough()
  const pending=readJsonRequest(req,4,{strict:true})
  req.end(Buffer.from('中文中文'))
  await assert.rejects(pending,/大小限制/)
  // Other endpoints retain old optional/empty-body semantics.
  assert.deepEqual(await postBody(null,[Buffer.from('{invalid')],false),{})
})


test('真实本地 HTTP 上传：完整和专项备份经不等长网络写块仍可读取、独立核验',async()=>{
  const root=temp()
  let server
  try{
    makeLifeFixture(root)
    put(root,'seen.md','长期资料：🎵方大同；曾经看过的记录 🐟\r\n')
    const general=createBackup({root,config:{},sqlite:{}})
    const memory=createLifeMemoryBackup(root)
    server=createServer(async(req,res)=>{
      try{
        const payload=await readJsonRequest(req,65_000_000,{strict:true})
        const summary=req.url==='/memory'?inspectLifeMemoryBackup(payload.backup):validateBackup(payload.backup)
        res.writeHead(200,{'content-type':'application/json'})
        res.end(JSON.stringify({ok:true,summary,hash:sha(payload.backup)}))
      }catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}
    })
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    const port=server.address().port
    for(const [url,backup,needle] of [['/business',general,'方大同'],['/memory',memory,'🎵']]){
      const payload=serialized(backup,'RESTORE_VERIFIED_DATA')
      const chunks=chunksAroundUtf8(payload,needle)
      const response=await new Promise((resolve,reject)=>{
        const req=httpRequest({hostname:'127.0.0.1',port,path:url,method:'POST',headers:{'content-type':'application/json;charset=utf-8'}},r=>{
          const bytes=[];r.on('data',d=>bytes.push(d));r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(Buffer.concat(bytes).toString('utf8'))}))
        })
        req.once('error',reject)
        for(const chunk of chunks)req.write(chunk)
        req.end()
      })
      assert.equal(response.status,200,JSON.stringify(response.body))
      assert.equal(response.body.hash,sha(backup))
      assert.equal(response.body.summary.integrity,'sha256-verified')
    }
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve))
    rmSync(root,{recursive:true,force:true})
  }
})

test('业务备份不能携带私密社交候选；专项备份可独立保留并恢复隐私记录',()=>{
  const src=temp(),dst=temp()
  try{
    makeLifeFixture(src)
    const privateRow={id:'c-'+'f'.repeat(18),key:'private:owner-dm:'+('b'.repeat(20)),
      kind:'private-social',bvid:'',visibility:'owner-private',status:'pending',memoryIds:[],text:'仅内部允许的低敏私密抽象'}
    const file=join(src,'life-memory/candidates.json')
    const old=JSON.parse(readFileSync(file,'utf8'))
    old.candidates.push(privateRow)
    put(src,'life-memory/candidates.json',old)
    put(src,'life-memory/private-insights.json',{schema:1,rows:[{id:'pi-'+'a'.repeat(18),visibility:'owner-private',text:'仅限私密域的抽象'}]})
    const business=createBackup({root:src,config:{},sqlite:{}})
    const businessRows=JSON.parse(business.files['life-memory/candidates.json']).candidates
    assert.ok(!businessRows.some(c=>c.kind==='private-social'))
    assert.equal(business.files['life-memory/private-insights.json'],undefined)
    const memory=createLifeMemoryBackup(src)
    assert.ok(JSON.parse(memory.files['life-memory/candidates.json']).candidates.some(c=>c.kind==='private-social'))
    assert.ok(memory.files['life-memory/private-insights.json'])
    restoreLifeMemoryBackup(dst,memory)
    assert.equal(readFileSync(join(dst,'life-memory/private-insights.json'),'utf8'),memory.files['life-memory/private-insights.json'])
  }finally{for(const dir of [src,dst])rmSync(dir,{recursive:true,force:true})}
})


test('用户业务恢复保留现有授权、会话绑定与任务账本，只应用明确安全的设置和规则',()=>{
  const root=temp(),old=temp()
  try{
    put(root,'owner-todos.json','{"version":1,"items":[]}');put(old,'owner-todos.json','{"version":1,"items":[]}')
    put(root,'duty.md','现行用户章程');put(old,'duty.md','旧用户章程')
    const current=createBackup({root,config:{personaPrompt:'现有人格',ownerDmActionsEnabled:false,mainSessionId:'current',masterEnabled:false}})
    const previous=createBackup({root:old,config:{personaPrompt:'历史人格',ownerDmActionsEnabled:true,mainSessionId:'old',masterEnabled:true}})
    const plan=planBusinessRestore(current,previous)
    assert.deepEqual(plan.patch,{personaPrompt:'历史人格'});assert.equal(plan.retainedSettings,3)
    assert.deepEqual(plan.names,['duty.md']);assert.deepEqual(plan.restore.sqlite,{})
    restoreBackupFiles(root,plan.restore,{reconcileDetails:false})
    assert.equal(readFileSync(join(root,'duty.md'),'utf8'),'旧用户章程')
    assert.equal(readFileSync(join(root,'owner-todos.json'),'utf8'),'{"version":1,"items":[]}')
    restoreBackupFiles(root,plan.rollback,{reconcileDetails:false})
    assert.equal(readFileSync(join(root,'duty.md'),'utf8'),'现行用户章程')
    put(old,'owner-todos.json','{"version":1,"items":[{"id":"old","type":"search_videos","status":"open","ownerAuthorized":true}]}')
    const diverged=planBusinessRestore(current,createBackup({root:old,config:{}}));assert.equal(diverged.retainedRecords,1);assert.ok(!Object.hasOwn(diverged.restore.files,'owner-todos.json'))
    assert.equal(readFileSync(join(root,'owner-todos.json'),'utf8'),'{"version":1,"items":[]}')
  }finally{for(const dir of [root,old])rmSync(dir,{recursive:true,force:true})}
})
test('现役记忆恢复保留历史差异，核对一致时不重写记忆',()=>{
  const root=temp(),old=temp()
  try{
    makeLifeFixture(root);makeLifeFixture(old)
    const current=createLifeMemoryBackup(root)
    assert.deepEqual(planPortableMemoryRepair(current,createLifeMemoryBackup(old)),{repairs:[],retainedRecords:0,requiredRevocations:[]})
    put(old,'life-memory/episodic.json',{version:1,episodes:[],archiveKeys:[],updatedAt:0})
    assert.deepEqual(planPortableMemoryRepair(current,createLifeMemoryBackup(old)),{repairs:[],retainedRecords:1,requiredRevocations:[]})
    assert.equal(createLifeMemoryBackup(root).files['life-memory/episodic.json'],current.files['life-memory/episodic.json'])
  }finally{for(const dir of [root,old])rmSync(dir,{recursive:true,force:true})}
})


test('仅补回仍清晰且当前未撤销的同源缺失细节；已遗忘或缺账本绝不激活',()=>{
  const root=temp()
  try{
    const ep={id:'e-'+'a'.repeat(18),kind:'watch',stage:'clear',visibility:'public-event',accountTag:'a'.repeat(16),at:1772450000000,bvid:'BV1pXHK6mE6z',text:'真实画面概况'}
    put(root,'life-memory/episodic.json',{version:1,episodes:[ep],archiveKeys:[],updatedAt:ep.at})
    put(root,'detail-protection/revocations-v1.json',{version:1,ids:[]})
    const store=createLifeMemoryDetailStore({dataDir:root})
    store.write({episode:ep,verified:true,fragments:[{fragmentId:'frame-001',type:'observed-scene',certainty:'model-observation',sourceRef:'receipt-0001',timeAnchorMs:[0,1000],content:'真实画面'}]})
    const older=createLifeMemoryBackup(root),file=join(root,'life-memory','details','v1',ep.accountTag,ep.id+'.json')
    assert.ok(existsSync(file));rmSync(file)
    let plan=planPortableMemoryRepair(createLifeMemoryBackup(root),older);assert.equal(plan.repairs.length,1)
    assert.equal(repairPortableMemoryDetails(root,plan),1);assert.equal(store.read(ep).ok,true)
    store.purge([ep.id]);plan=planPortableMemoryRepair(createLifeMemoryBackup(root),older);assert.equal(plan.repairs.length,0);assert.equal(store.read(ep).ok,false)
    rmSync(join(root,'detail-protection','revocations-v1.json'));assert.equal(planPortableMemoryRepair(createLifeMemoryBackup(root),older).repairs.length,0)
  }finally{rmSync(root,{recursive:true,force:true})}
})


test('same-character business backup restores explicitly selected Life plan, never grants or master switch',()=>{
 const root=temp(),old=temp(),characterId='11111111-1111-4111-8111-111111111111';
 const identity={version:1,id:characterId,createdAt:1};
 const scope={characterId,canResume:true,scopeRevision:'1:2'};
 const saved={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,peakValley:false,autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:250,autonomousPlannerStartHour:9,autonomousPlannerEndHour:23,videoAgentMinIntervalMinutes:15,videoAgentReadTargetPerRound:8,videoAgentPickTargetPerRound:5,ownerDmActionsEnabled:true,mainSessionId:'old'};
 const paused={...saved,lifeAgentMode:'off',autonomousPlannerEnabled:false,autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:80,ownerDmActionsEnabled:false,mainSessionId:'current'};
 try{
  for(const dir of [root,old])put(dir,'character-identity.json',identity);
  const incoming=JSON.parse(JSON.stringify(createBackup({root:old,config:saved}))),current=createBackup({root,config:paused});
  const preview=previewBusinessLifeRestore(paused,incoming,scope);assert.equal(preview.available,true);assert.deepEqual(preview.changed.lifeAgentMode,{before:'off',after:'active'});
  const conservative=planBusinessRestore(current,incoming);assert.deepEqual(conservative.patch,{});assert.ok(conservative.retainedSettingKeys.includes('lifeAgentMode'));
  const confirmed=planBusinessRestore(current,incoming,{...scope,lifeRevision:preview.revision});
  assert.deepEqual(confirmed.patch,{lifeAgentMode:'active',autonomousPlannerEnabled:true,autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:250});
  assert.ok(confirmed.retainedSettingKeys.includes('ownerDmActionsEnabled'));assert.ok(confirmed.retainedSettingKeys.includes('mainSessionId'));
  const after={...paused,...confirmed.patch};assert.equal(after.masterEnabled,true);assert.equal(after.ownerDmActionsEnabled,false);assert.equal(after.mainSessionId,'current');assert.deepEqual(previewBusinessLifeRestore(after,incoming,scope).changed,{});
  assert.throws(()=>planBusinessRestore(current,incoming,{...scope,lifeRevision:'stale'}),/已变化/);
  assert.throws(()=>planBusinessRestore(current,incoming,{...scope,scopeRevision:'2:2',lifeRevision:preview.revision}),/已变化/);
  assert.throws(()=>planBusinessRestore(current,incoming,{...scope,canResume:false,lifeRevision:preview.revision}),/核验/);
  assert.equal(previewBusinessLifeRestore({...paused,masterEnabled:false},incoming,scope).available,false);
  assert.equal(previewBusinessLifeRestore(paused,incoming,{...scope,characterId:'other'}).available,false);
  const bad=createBackup({root:old,config:{...saved,autonomousPlannerDailyLimit:99999}});assert.equal(previewBusinessLifeRestore(paused,bad,scope).available,false);
  const disabled=createBackup({root:old,config:{...saved,lifeAgentMode:'off',autonomousPlannerEnabled:true,masterEnabled:false}});
  const stop=previewBusinessLifeRestore(after,disabled,{...scope,canResume:false});assert.equal(stop.available,true);assert.deepEqual(stop.patch,{lifeAgentMode:'off',autonomousPlannerEnabled:false});
  const legacyRoot=temp();try{const legacy=createBackup({root:legacyRoot,config:saved});assert.equal(previewBusinessLifeRestore(paused,legacy,scope).available,false)}finally{rmSync(legacyRoot,{recursive:true,force:true})}
 }finally{for(const dir of [root,old])rmSync(dir,{recursive:true,force:true})}
});


test('classified preview and selection restore ordinary preferences, keep authorities and old records',()=>{
 const root=temp(),old=temp(),characterId='11111111-1111-4111-8111-111111111111';
 const identity={version:1,id:characterId,createdAt:1};
 const scope={characterId,canResume:true,scopeRevision:'account:1',normalizePatch:p=>p,verifyGroup:()=>{throw Error('未核验')}};
 try{
  for(const dir of [root,old]){makeLifeFixture(dir);put(dir,'character-identity.json',identity)}
  put(root,'duty.md','current');put(old,'duty.md','backup');
  const before={personaPrompt:'current',mainSessionMemoryHalfLifeDays:45,dmOwnerPollSeconds:150,visionFrames:24,diagVisionEnabled:true,pluginDefaultModelProvider:'current',pluginDefaultModelId:'current',ownerDmActionsEnabled:false,mainSessionId:'current'};
  const after={...before,personaPrompt:'backup',mainSessionMemoryHalfLifeDays:30,dmOwnerPollSeconds:120,visionFrames:12,diagVisionEnabled:false,pluginDefaultModelProvider:'old',pluginDefaultModelId:'old',ownerDmActionsEnabled:true,mainSessionId:'old'};
  const current=createBackup({root,config:before}),incoming=createBackup({root:old,config:after});
  const preview=businessRestorePreview(current,incoming,scope);assert.equal(preview.patches,undefined);assert.equal(preview.memory.backup.episodes.count,1);assert.equal(preview.memory.backup.episodes.lastAt,1772450000000);
  assert.deepEqual(preview.groups.filter(g=>g.available).map(g=>g.id),['identity','memory','messages','perception','diagnostics']);
  assert.ok(preview.groups.find(g=>g.id==='protected').rows.every(x=>x.before===undefined&&x.after===undefined));
  const options={...scope,selection:['identity','memory','messages','perception','diagnostics'],restoreRevision:preview.revision};
  const plan=planBusinessRestore(current,incoming,options);
  assert.deepEqual(plan.patch,{personaPrompt:'backup',mainSessionMemoryHalfLifeDays:30,dmOwnerPollSeconds:120,visionFrames:12,diagVisionEnabled:false});
  assert.deepEqual(plan.names,['duty.md']);restoreBackupFiles(root,plan.restore,{reconcileDetails:false});assert.equal(readFileSync(join(root,'duty.md'),'utf8'),'backup');
  assert.ok(plan.retainedSettingKeys.includes('ownerDmActionsEnabled'));assert.ok(plan.retainedSettingKeys.includes('mainSessionId'));
  assert.throws(()=>planBusinessRestore(current,incoming,{...options,selection:['protected']}),/不可用/);
  assert.throws(()=>planBusinessRestore(current,incoming,{...options,selection:['textModels']}),/不可用/);
  const verified={...scope,verifyGroup:()=>{}};const verifiedPreview=businessRestorePreview(current,incoming,verified);
  assert.deepEqual(planBusinessRestore(current,incoming,{...verified,selection:['textModels'],restoreRevision:verifiedPreview.revision}).patch,{pluginDefaultModelProvider:'old',pluginDefaultModelId:'old'});
  assert.throws(()=>planBusinessRestore(current,incoming,{...options,scopeRevision:'account:2'}),/已变化/);
  const changed=createBackup({root,config:{...before,dmOwnerPollSeconds:180}});assert.throws(()=>planBusinessRestore(changed,incoming,options),/已变化/);
  const invalid=createBackup({root:old,config:{...after,dmOwnerPollSeconds:999}});const bounded={...scope,normalizePatch:p=>({...p,...('dmOwnerPollSeconds' in p?{dmOwnerPollSeconds:150}:{})})};
  assert.equal(businessRestorePreview(current,invalid,bounded).groups.find(g=>g.id==='messages').available,false);
  // Schema 1 has no original integrity manifest; supported ordinary preferences still restore after explicit confirmation in the route.
  const legacy={format:'dsh-bili-scroll-plus-backup',schema:1,files:{},config:{mainSessionMemoryHalfLifeDays:30},sqlite:{}};
  const oldPreview=businessRestorePreview(current,legacy,scope);assert.equal(oldPreview.memory.backup.episodes,null);assert.equal(validateBackup(legacy).integrity,'legacy-unsealed');
  assert.deepEqual(planBusinessRestore(current,legacy,{...scope,selection:['memory'],restoreRevision:oldPreview.revision}).patch,{mainSessionMemoryHalfLifeDays:30});
 }finally{for(const dir of [root,old])rmSync(dir,{recursive:true,force:true})}
});

test('memory preview describes actual repair availability, not backed-up record count',()=>{
 const root=temp();try{makeLifeFixture(root);const backup=createLifeMemoryBackup(root);const preview=previewPortableMemoryRepair(backup,backup,'scope:1');
 assert.equal(preview.backup.episodes.count,1);assert.equal(preview.backup.episodes.lastAt,1772450000000);assert.equal(preview.repairable,0);
 assert.notEqual(preview.revision,previewPortableMemoryRepair(backup,backup,'scope:2').revision);
 assert.equal(backupMemoryOverview({}).episodes,null);assert.equal(backupMemoryOverview({}).longTerm,null);
 }finally{rmSync(root,{recursive:true,force:true})}
});


test('sealed same-character business backup can enter the independent memory repair planner without widening scope',()=>{
 const root=temp();const characterId='11111111-1111-4111-8111-111111111111';try{makeLifeFixture(root);put(root,'character-identity.json',{version:1,id:characterId,createdAt:1});const backup=createBackup({root,config:{}});
 const source=memoryRepairSource(backup,{characterId});assert.equal(source.format,'dafeiyu-life-memory-backup');assert.equal(inspectLifeMemoryBackup(source).memory.episodes.count,1);assert.equal(previewPortableMemoryRepair(source,source).repairable,0);
 assert.throws(()=>memoryRepairSource(backup,{characterId:'other'}),/相同角色/);assert.throws(()=>memoryRepairSource({...backup,schema:1},{characterId}),/原始校验清单/);assert.throws(()=>memoryRepairSource({...backup,files:{...backup.files,'duty.md':'tampered'}},{characterId}),/完整性/);
 }finally{rmSync(root,{recursive:true,force:true})}
});
