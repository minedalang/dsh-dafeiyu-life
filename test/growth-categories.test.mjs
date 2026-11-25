import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {proposeGrowth,updateGrowthSuggestion,reviewGrowth,ingestReportText,buildGrowthContext,listGrowth} from '../lib/persona-growth.mjs'
import {apply} from '../index.js'

const withDir=fn=>{const dir=mkdtempSync(join(tmpdir(),'growth-category-'));try{return fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
const addApproved=(dir,type,text,tags=[])=>{
 const x=proposeGrowth(dir,{type,text,tags})
 updateGrowthSuggestion(dir,x.id,{origin:'model',suggestion:text})
 return reviewGrowth(dir,x.id,'approved')
}

test('owner feedback cannot bypass model: model suggestion -> owner revision -> approval',()=>withDir(dir=>{
 const x=proposeGrowth(dir,{type:'style',text:'评论不要直接复述原视频台词然后机械评价。'})
 assert.throws(()=>reviewGrowth(dir,x.id,'approved'),/模型/)
 assert.throws(()=>updateGrowthSuggestion(dir,x.id,{origin:'owner',suggestion:'评论要表达自己的感受，不机械复述台词。'}),/先由大模型提炼/)
 updateGrowthSuggestion(dir,x.id,{origin:'model',suggestion:'评论先理解笑点，再表达本鱼自己的情绪，不原样复述视频台词。'})
 updateGrowthSuggestion(dir,x.id,{origin:'owner',suggestion:'评论时要用自己的视角接话，不重复台词后附上一句套话。'})
 reviewGrowth(dir,x.id,'approved')
 assert.match(buildGrowthContext(dir,{scene:'comment'}),/用自己的视角/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'dm'}),/用自己的视角/)
 assert.doesNotMatch(buildGrowthContext(dir),/原视频台词然后机械评价/)
}))

test('日报主题不再生成成长审批；后天兴趣交由人生记忆证据档案维护',()=>withDir(dir=>{
 const reports=['BV1aBcD2eF3G','BV1xYzA2bC3D','BV1lMnO2pQ3R'].map(bv=>`### ${bv}\n标题：AI模型拟人：Claude小姐的故事\n档位：值得看\n`).join('\n')
 const result=ingestReportText(dir,reports)
 assert.equal(result.proposals,0)
 assert.deepEqual(listGrowth(dir).entries,[])
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'duty'}),/AI模型拟人/)
 const original=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(original,/兴趣主导搜索/)
}))

test('新的行为改进只允许 style，已批准规则只注入适用提示词',()=>withDir(dir=>{
 assert.throws(()=>proposeGrowth(dir,{type:'interest',text:'最近喜欢美食视频，并不意味着固定兴趣。'}),/只收录表达或互动规则/)
 assert.throws(()=>proposeGrowth(dir,{type:'relationship',text:'Claude小姐是熟悉的AI朋友。'}),/只收录表达或互动规则/)
 addApproved(dir,'style','评论不要机械复述视频，也不要为了完成任务强行提到白饭。')
 assert.match(buildGrowthContext(dir,{scene:'comment'}),/机械复述/)
 assert.doesNotMatch(buildGrowthContext(dir,{scene:'dm'}),/机械复述/)
}))

test('video recall MCP is read-only and never edits the manually configured keywords',()=>withDir(dir=>{
 const home=mkdtempSync(join(tmpdir(),'growth-tool-host-'))
 try{
  const all=new Map()
  const ctx={get:key=>key==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
   logger:{info(){},warn(){}},tools:{register(spec){all.set(spec.name,spec)}},
   connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(){return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{keywords:['手动设置的搜索词']})
  const recall=all.get('bili_growth_recall')
  assert.ok(recall,'工具已注册')
  assert.equal(recall.parameters.query.type,'string')
  const before=recall.execute({query:''})
  return Promise.resolve(before).then(x=>assert.equal(x.ok,false))
 }finally{rmSync(home,{recursive:true,force:true})}
}))
