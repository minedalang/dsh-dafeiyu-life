/**
 * Read-only architecture-to-code contract check.
 * Mermaid diagrams live in docs/architecture/diagrams/ and are the source for
 * GitHub rendering. Every @code annotation binds a *diagram node* to a real
 * production source file + recognizable implementation symbol. This is not
 * runtime proof or release acceptance; it detects stale/renamed/removed links.
 * The single checked-in vendor/bilibili-mcp/mcp_server.py entrypoint may be
 * anchored because its Python MCP exposes the actual video Agent tools.
 */
import {readFileSync,existsSync,writeFileSync} from 'node:fs'
import {resolve,join,relative,sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const diagrams=['life-system-current.mmd','life-candidates-current.mmd','life-receipt-memory-current.mmd','life-universal-episodes-current.mmd']
const required=['todos','cues','opportunities','intentions','social','video','reflection','eventRefs','planner','catalog','verified','outbox','episode','recall']
const anchor=/^%% @code\s+([A-Za-z][A-Za-z0-9_]*)\s*\|\s*([^|\r\n]+?)\s*\|\s*(\S[^\r\n]*?)\s*$/gm
const diagramDir='docs/architecture/diagrams'
const canonicalDoc='docs/architecture/life-system-current.md'
const previewDoc='docs/architecture/life-system-current-view.md'

/** A GitHub-renderable preview derived from the four canonical .mmd files. */
export function renderLifeArchitectureView(root,{overrides={}}={}){
  const read=name=>Object.hasOwn(overrides,name)?overrides[name]:readFileSync(join(root,name),'utf8')
  return '# 大肥鱼 Life 源码全景（自动生成）\n\n'+
    '> 不要直接编辑此页；修改 `diagrams/life-system-current.mmd` / `diagrams/life-candidates-current.mmd` / `diagrams/life-receipt-memory-current.mmd` / `diagrams/life-universal-episodes-current.mmd` 后运行 `npm run write:life-architecture-view`。架构状态及未实现部分见 [源码审计](./life-system-current.md)。\n\n'+
    diagrams.map((name,i)=>'## '+(['一、系统全景','二、八类候选细目','三、可信回执与记忆闭环','四、统一 Life Episode 因果持续性'][i])+'\n\n```mermaid\n'+read(join(diagramDir,name)).trimEnd()+'\n```\n').join('\n')
}

export function checkLifeArchitecture(root,{overrides={}}={}){
  const errors=[],observed=new Set()
  const read=(name)=>Object.hasOwn(overrides,name)?overrides[name]:readFileSync(join(root,name),'utf8')
  for(const name of diagrams){
    const rel=join(diagramDir,name)
    let diagram
    try{diagram=read(rel)}catch(e){errors.push(`无法读取 ${rel}: ${e.code||'error'}`);continue}
    if(!/^flowchart\s+(TB|TD|LR|RL)\b/m.test(diagram))errors.push(`${rel}: 缺少 Mermaid flowchart 声明`)
    const anchors=[...diagram.matchAll(anchor)]
    if(anchors.length<7)errors.push(`${rel}: @code 锚点太少，无法验证主要代码归属`)
    for(const [,node,pathRaw,markerRaw] of anchors){
      const path=pathRaw.trim(),marker=markerRaw.trim()
      const full=resolve(root,path),back=relative(root,full)
      if(!back||back.startsWith('..'+sep)||back==='..'||path.startsWith('/')||!path.startsWith('lib/')&&!path.startsWith('index.')&&path!=='vendor/bilibili-mcp/mcp_server.py' ){
        errors.push(`${rel}: @code ${node} 不允许访问项目外文件: ${path}`);continue
      }
      if(!new RegExp('(?:^|\\n)\\s*'+node+'\\[','m').test(diagram)){
        errors.push(`${rel}: @code ${node} 没有对应的 Mermaid 节点定义`)
      }
      observed.add(node)
      if(!existsSync(full)){errors.push(`${rel}: @code ${node} 关联源码不存在: ${path}`);continue}
      const content=readFileSync(full,'utf8')
      if(!content.includes(marker))errors.push(`${rel}: @code ${node} 的源码标记失效: ${path} :: ${marker}`)
    }
  }
  for(const name of required)if(!observed.has(name))errors.push(`缺少核心候选/中心节点代码锚点: ${name}`)
  try{if(read(previewDoc)!==renderLifeArchitectureView(root,{overrides}))errors.push('Mermaid 可视化预览没有与当前 .mmd 同步；运行 npm run write:life-architecture-view')}
  catch{errors.push('缺少由 Mermaid 生成的可视化预览文档')}
  let doc=''
  try{doc=read(canonicalDoc)}catch{errors.push('缺少当前架构审计文档')}
  for(const name of diagrams)if(!doc.includes(name))errors.push(`当前架构审计文档未链接 ${name}`)
  const readme=read('docs/architecture/README.md')
  if(!readme.includes('life-system-current.md'))errors.push('架构索引没有指向当前 Life 审计版总图')
  return {ok:errors.length===0,checkedDiagrams:diagrams.length,anchoredNodes:observed.size,errors}
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)
if(invoked){
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
  if(process.argv.includes('--write-preview')){
    writeFileSync(join(root,previewDoc),renderLifeArchitectureView(root),'utf8')
    console.log('已从四张 Mermaid 源图刷新 GitHub 可视化预览')
  }
  const result=checkLifeArchitecture(root)
  if(result.ok)console.log(`Life 架构契约检查通过：${result.checkedDiagrams} 张 Mermaid，${result.anchoredNodes} 个唯一代码节点`)
  else{for(const message of result.errors)console.error('Life 架构检查失败：'+message);process.exitCode=1}
}
