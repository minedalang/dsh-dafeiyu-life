import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=relative=>readFileSync(new URL('../'+relative,import.meta.url),'utf8')
const html=source('lib/management-console.html')
const script=source('lib/management-console.js')
const backend=source('index.js')

test('S0/S1 导出在可见生活时间线并且只有一个真实执行按钮',()=>{
 const lifePanel=html.indexOf('<section id="panel-life-agent"')
 const timeline=html.indexOf('id="life-timeline-comment-status"')
 const button=html.indexOf('id="life-release-evidence-export"')
 const hiddenDeveloper=html.indexOf('id="life-agent-expert-settings"')
 assert.ok(lifePanel>=0&&lifePanel<timeline)
 assert.ok(timeline<button&&button<hiddenDeveloper,'导出不能藏在两层开发者折叠中')
 assert.equal(html.split('id="life-release-evidence-export"').length-1,1)
 assert.match(html,/原创主评论准入 · 最近视频轮次/)
 assert.match(script,/request\('\/life-agent\/release-acceptance-evidence'\)/)
 assert.match(script,/life-timeline-comment-status/)
 assert.match(script,/evidence\?\.readOnly!==true\|\|evidence\?\.releaseReady!==false/)
})

test('删除同时改动两种公开评论额度的旧预设，保留两个独立硬边界',()=>{
 assert.doesNotMatch(html,/id="comment-quota-preset-1000"|公开评论 · 统一容量方案/)
 assert.doesNotMatch(script,/comment-quota-preset-1000/)
 assert.equal(html.split('id="quota-comment-daily"').length-1,1)
 assert.equal(html.split('id="comment-per-day"').length-1,1)
 assert.match(html,/后台回复同时受两者约束/)
 assert.match(script,/\['quota-comment-daily','commentDailyLimit'/)
 assert.match(script,/\['comment-per-day','commentReplyPerDay'/)
 assert.match(script,/for\(const \[id,key,min,max\] of quotaFields\)payload\[key\]=boundedInt/)
})

test('所有容量保存须有本地 readback；原生 DSH 镜像缺失不得伪装保存失败',()=>{
 assert.match(script,/const localSaveNotice=\(result,label\)=>/)
 assert.match(script,/if\(result\?\.localVerified!==true\)throw Error/)
 assert.match(script,/插件已核验本地生效（DSH 原生设置页不支持写入，仅镜像未同步）/)
 assert.match(script,/message\(localSaveNotice\(saved,'全部次数与额度已保存'\)\)/)
 assert.match(script,/message\(localSaveNotice\(saved,'后台评论互动设置已保存'\)\)/)
 assert.match(script,/message\(localSaveNotice\(r,'记忆与反思设置已保存'\)\)/)
 assert.doesNotMatch(script,/已写插件配置，但同步到 DSH 失败/)
 assert.match(backend,/const stored=savedCfg\(\),effective=loadCfg\(\)/)
 assert.match(backend,/if\(mismatch.length\)throw Error/)
 assert.match(backend,/localVerified:true/)
 assert.match(backend,/markOverride\(Object.keys\(clean\), true\)/)
})

test('日志不再复制设置 payload 或每次保存重复输出缺失原生 settings 服务',()=>{
 assert.match(backend,/let lastHostMirrorError = ''/)
 assert.match(backend,/lastHostMirrorError/)
 assert.match(backend,/设置已保存并本地核验/)
 assert.doesNotMatch(backend,/log\(`设置已更新：\$\{JSON\.stringify/)
})
