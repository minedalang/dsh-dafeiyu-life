import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
const agents=readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8')
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))

test('README is a complete user homepage, not just this release changelog',()=>{
  const headings=['## ✨ 鱼鱼能做什么','## 🆕 2.8.3 让经历成为记忆','## 🚀 开始使用','## 🔒 让自由有边界','## 🌱 未来规划：让生活更有故事','## ❤️ 致谢']
  let prev=-1
  for(const heading of headings){const index=readme.indexOf(heading);assert.ok(index>prev,`${heading} is missing or out of order`);prev=index}
  const history=readFileSync(new URL('../docs/近期版本新功能.md',import.meta.url),'utf8');
  assert.match(readme,/近期版本新功能/);assert.doesNotMatch(readme,/^## 🆕 2\.8\.2 /m);assert.ok(history.includes('## 🆕 2.8.2 视频感知体验优化'));assert.match(history,/video-perception-current\.svg/);
  assert.equal(readme.slice(readme.indexOf(headings[4])).match(/^## /gm).length,2,'future roadmap must be the final section immediately before acknowledgements')
  if(pkg.version.startsWith('2.8.3'))assert.match(readme,/\[🆕 2\.8\.3 版本亮点\]\(#-283-让经历成为记忆\)/, 'current-version navigation must link to the real heading');
  else assert.match(readme,/\[🆕 2\.8\.2 更新内容\]\(#-282-视频感知体验优化\)/, 'current-version navigation must link to the real heading')
  for(const feature of ['Life','B站','私信','评论','人物关系','记忆','兴趣','情绪','主 Session','三维神经回忆场','快速设置','DSHMarket','MIT','GitHub Issues'])
    assert.ok(readme.includes(feature),`User-facing capability or entrypoint missing: ${feature}`)
  // Official-version source is not proof that every channel has completed distribution.
  assert.ok(readme.includes('当前版本源码：'+pkg.version),
    'README must identify the stable package.json version')
  assert.doesNotMatch(readme,/当前源码：.*仍是测试版本|2\.8\.2 开发预览/)
  assert.match(readme,/以 GitHub Release、npm 和 DSHMarket 的实际版本为准/,
    'verify actual channel availability independently of source version')
})

test('AGENTS retains mandatory user README editorial rule',()=>{
  assert.match(agents,/README 用户首页长期规范/)
  assert.match(agents,/长期特色功能/)
  assert.match(agents,/未来规划须固定在致谢正上方/)
  assert.match(agents,/README 的读者是安装与使用大肥鱼的人/)
})


test('2.8.3 user-facing feature introduction is honest and uses a self-contained SVG',()=>{
 if(!pkg.version.startsWith('2.8.3'))return;
 const title='## 🆕 2.8.3 让经历成为记忆';assert.ok(readme.indexOf(title)>readme.indexOf('## ✨ 鱼鱼能做什么'));assert.ok(readme.indexOf(title)<readme.indexOf('## 🚀 开始使用'));
 assert.match(readme,/\[🆕 2\.8\.3 版本亮点\]\(#-283-让经历成为记忆\)/);for(const feature of ['神经回忆场升级','看得见的视频感知','深浅双层记忆','更自然的联想回忆','分层存储与自动备份'])assert.ok(readme.includes(feature),feature);
 assert.match(readme,/跨聊天场景自主补看已接线，完整体验仍待实机验收/);assert.ok(readme.length<10000);
 const svg=readFileSync(new URL('../docs/architecture/assets/283-perception-memory.svg',import.meta.url),'utf8');assert.match(svg,/<svg[^>]+viewBox=/);assert.match(svg,/<title /);assert.match(svg,/<desc /);assert.match(svg,/非实机截图/);assert.doesNotMatch(svg,/<script|<foreignObject|<image|(?:href=|xlink:href=)["']https?:\/\//);
})


test('four-core product illustration is local and explicitly separates the planned workbench',()=>{
 const name='docs/architecture/assets/dafeiyu-four-cores.svg'
 assert.ok(readme.includes(']('+name+')'))
 const svg=readFileSync(new URL('../'+name,import.meta.url),'utf8')
 assert.match(svg,/<svg[^>]+viewBox=/);assert.match(svg,/自由工作台为规划中/);assert.match(svg,/非实机截图/)
 assert.doesNotMatch(svg,/<script|<foreignObject|<image|(?:href=|xlink:href=)["']https?:\/\//)
 assert.match(readme,/自由工作台仍处于规划阶段/)
})
