import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recentComments} from '../lib/recent-comments.mjs'
import {recordConfirmedRecipient} from '../lib/confirmed-comment-recipients.mjs'

const A='BV17x411w7KC',B='BV1mzso6uEZh'
test('评论跨页搜索：BV / 正文 / rpid / 当前接收人可信昵称与 UID，筛选优先于分页',()=>{
 const home=mkdtempSync(join(tmpdir(),'dsh-dev5-comments-'))
 try{
  const rows=['## 评论记录']
  for(let i=0;i<61;i++)rows.push(`| ${i===60?B:A} | ${322430862000+i} | 0 | 2026-11-01 12:${String(i%60).padStart(2,'0')}:00 | ${i===60?'藏宝图中的线索':'普通评论内容'} |`)
  // A verified reply enriches the matching confirmed ledger item only.
  rows.push(`| ${A} | 322430866888 | 322430866000 | 2026-11-02 12:00:00 | 真的看到你了 |`)
  writeFileSync(join(home,'seen.md'),rows.join('\n'),'utf8')
  recordConfirmedRecipient(home,{bvid:A,rpid:'322430866888',uid:'210228238',name:'海边朋友',comment:'你发现什么'})
  assert.equal(recentComments(home,{limit:20}).rows.length,20)
  assert.deepEqual(recentComments(home,{limit:10,search:B.toLowerCase()}).rows.map(x=>x.bvid),[B])
  assert.equal(recentComments(home,{search:'藏宝图'}).total,1)
  assert.equal(recentComments(home,{search:'322430862060'}).total,1)
  assert.equal(recentComments(home,{search:'210228238'}).total,1)
  assert.equal(recentComments(home,{search:'海边朋友'}).total,1)
  assert.equal(recentComments(home,{search:'不存在'}).total,0)
  assert.equal(recentComments(home,{search:'藏宝图',day:'2026-11-02'}).total,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('评论页默认折叠、双列搜索、动态开关、意向来源并列卡片可访问，旧导航已移除',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(html,/<details class="settings-section comment-meme-fold" id="comments-meme-settings">/)
 assert.match(html,/id="comments-search" type="search"/)
 assert.match(html,/id="recent-comments-list" class="records comments-record-grid"/)
 assert.doesNotMatch(html,/<nav class="context-jump" aria-label="评论页分区">/)
 assert.match(html,/class="life-plan-overview" role="group"/)
 assert.match(html,/prefers-reduced-motion:reduce/)
 for(const id of ['models-comment-memes','comment-watch-replies','comment-at-enabled','backup-auto-enabled','diag-mention-enabled','dm-active-enabled','personality-evolution-enabled']){
  assert.match(html,new RegExp(`<input[^>]*\\brole="switch"[^>]*\\bid="${id}"`))
 }
 assert.match(js,/query\.set\('search',search\.slice\(0,120\)\)/)
 assert.match(server,/search: url\.searchParams\.get\('search'\)/)
})
