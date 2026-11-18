import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
const agents=readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8')

test('README is a complete user homepage, not just this release changelog',()=>{
  const headings=['## ✨ 鱼鱼能做什么','## 🆕 2.8.1 新特性','## 🚀 开始使用','## 🔒 让自由有边界','## 🌱 未来规划：让生活更有故事','## ❤️ 致谢']
  let prev=-1
  for(const heading of headings){const index=readme.indexOf(heading);assert.ok(index>prev,`${heading} is missing or out of order`);prev=index}
  assert.equal(readme.slice(readme.indexOf(headings[4])).match(/^## /gm).length,2,'future roadmap must be the final section immediately before acknowledgements')
  for(const feature of ['Life','B站','私信','评论','人物关系','记忆','兴趣','情绪','主 Session','三维神经回忆场','快速设置','DSHMarket','MIT','GitHub Issues'])
    assert.ok(readme.includes(feature),`User-facing capability or entrypoint missing: ${feature}`)
  // A release-candidate README must disclose that a source version is not
  // evidence of availability in external registries; avoid obsolete labels.
  assert.match(readme,/当前源码标识为.*`2\.8\.1`/,'README must identify the current release source')
  assert.match(readme,/Git 提交或版本号本身不代表已经上架.*以 npm、DSHMarket 与 GitHub Release 实际显示的版本为准/,
    'unfinished release cannot claim full publication')
})

test('AGENTS retains mandatory user README editorial rule',()=>{
  assert.match(agents,/README 用户首页长期规范/)
  assert.match(agents,/长期特色功能/)
  assert.match(agents,/未来规划须固定在致谢正上方/)
  assert.match(agents,/README 的读者是安装与使用大肥鱼的人/)
})
