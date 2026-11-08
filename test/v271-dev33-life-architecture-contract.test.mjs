import test from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {readFileSync} from 'node:fs'
import {checkLifeArchitecture} from '../scripts/check-life-architecture.mjs'
const root=fileURLToPath(new URL('..',import.meta.url))
const name='docs/architecture/diagrams/life-system-current.mmd'
const source=readFileSync(join(root,name),'utf8')

test('the current Mermaid source must match real Life source symbols and links',()=>{
  const result=checkLifeArchitecture(root)
  assert.deepEqual(result.errors,[])
  assert.ok(result.anchoredNodes>=18)
})

test('renaming an implementation symbol causes architecture drift failure',()=>{
  const swapped=source.replace('export function validateOfferedLifeAction','export function nonexistent_architecture_symbol')
  const result=checkLifeArchitecture(root,{overrides:{[name]:swapped}})
  assert.equal(result.ok,false)
  assert.ok(result.errors.some(x=>x.includes('menuGuard')&&x.includes('源码标记失效')))
})

test('a diagram node cannot survive deletion by leaving an orphan source marker',()=>{
  const swapped=source.replace('    menuGuard["后端再次核对：action/id/BV/capability 必须确在本轮菜单"]\n','')
  const result=checkLifeArchitecture(root,{overrides:{[name]:swapped}})
  assert.equal(result.ok,false)
  assert.ok(result.errors.some(x=>x.includes('menuGuard')&&x.includes('Mermaid 节点定义')))
})

test('architecture source annotations cannot read outside the project',()=>{
  const swapped=source.replace('lib/life-action-memory.mjs | export function verifiedLifeActionEvent','../untrusted.mjs | export function verifiedLifeActionEvent')
  const result=checkLifeArchitecture(root,{overrides:{[name]:swapped}})
  assert.equal(result.ok,false)
  assert.ok(result.errors.some(x=>x.includes('不允许访问项目外文件')))
})

test('the generated GitHub Mermaid preview must not drift from canonical diagrams',()=>{
  const view='docs/architecture/life-system-current-view.md'
  const result=checkLifeArchitecture(root,{overrides:{[view]:'# 手工改动过的旧图'}})
  assert.equal(result.ok,false)
  assert.ok(result.errors.some(x=>x.includes('可视化预览没有与当前 .mmd 同步')))
})
