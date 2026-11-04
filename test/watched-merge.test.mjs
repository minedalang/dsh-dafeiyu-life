import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeWatchedRows } from '../lib/watched.mjs'
const BV1='BV1c8nK6zEGV', BV2='BV17Mp46wEhr', BV3='BV18VHN6sEdq', BV4='BV1TBHp6AEAC'
function fixture(t) { const dir=mkdtempSync(join(tmpdir(),'bili-watched-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));for(const d of ['out','digest'])mkdirSync(join(dir,d));return dir }
test('无判重表也能从日报的 ### BV 标题恢复挑中记录',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'out','2026-10-24.md'),`# 今日第九轮\n\n### ${BV1}\n标题：架构讲解\nUP：某UP\n**档位**：值得看\n\n### ${BV2}\n标题：MC整活\nUP：另一UP\n\n- 只在其他说明提到 ${BV4}，没有挑中\n`)
 const rows=mergeWatchedRows([],dir)
 assert.equal(rows.length,2)
 assert.deepEqual(rows.map(x=>x.bvid),[BV1,BV2])
 assert.ok(rows.every(x=>x.picked && x.autonomousSelected && x.day==='2026-10-24'))
 assert.equal(rows[0].title,'架构讲解')
})
test('融合视频归档，未挑中视频不误标挑中',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'digest','2026-10.md'),`2026-10-24 · ${BV1} · 架构讲解 · UP甲 · 值得看 · https://www.bilibili.com/video/${BV1}\n2026-10-24 · ${BV4} · 无字幕OP · UP乙 · 跳过（无字幕） · https://www.bilibili.com/video/${BV4}\n`)
 const rows=mergeWatchedRows([],dir)
 assert.equal(rows.length,2)
 assert.equal(rows.find(x=>x.bvid===BV1).picked,false)
 assert.equal(rows.find(x=>x.bvid===BV4).picked,false)
 assert.match(rows.find(x=>x.bvid===BV4).status,/跳过/)
})
test('日报升级相同记录为挑中且不重复，保留已有信息',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'out','2026-10-24.md'),`### ${BV3}\n标题：模型娘化教程\n`)
 const old=[{day:'2026-10-24',bvid:BV3,title:BV3,up:'UP甲',status:'看过',picked:false,delivered:true}]
 const rows=mergeWatchedRows(old,dir)
 assert.equal(rows.length,1)
 assert.equal(rows[0].title,'模型娘化教程')
 assert.equal(rows[0].up,'UP甲')
 assert.equal(rows[0].picked,true)
 assert.equal(rows[0].delivered,true)
})
test('判重表非表格写法也能识别；评论记录不算观看记录',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'seen.md'),`## 评论记录（BV | rpid）\n| ${BV3} | 321726267888 | 2026-10-24 |\n## 看过的视频\n- 2026-10-24 · ${BV1} · 架构讲解 · UP甲 · 收下\n- 2026-10-24 · ${BV2} · 整活视频 · UP乙 · 跳过（没字幕）\n`)
 const rows=mergeWatchedRows([],dir)
 assert.equal(rows.length,2)
 assert.equal(rows.find(x=>x.bvid===BV1).picked,true)
 assert.equal(rows.find(x=>x.bvid===BV1).autonomousSelected,true)
 assert.equal(rows.find(x=>x.bvid===BV2).picked,false)
})
test('忽略报告普通段落的 BV 和代码围栏里的 BV',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'out','2026-10-24.md'),`已读：${BV1}\n\n\`\`\`md\n### ${BV2}\n\`\`\`\n\n### ${BV3}\n标题：真正挑中\n`)
 const rows=mergeWatchedRows([],dir)
 assert.deepEqual(rows.map(x=>x.bvid),[BV3])
})
test('不修改任何已有判重表',t=>{
 const dir=fixture(t)
 const before=`## 看过的视频\n- 2026-10-24 · ${BV1} · 已浏览\n`
 writeFileSync(join(dir,'seen.md'),before)
 writeFileSync(join(dir,'out','2026-10-24.md'),`### ${BV1}\n标题：明确挑中\n`)
 const rows=mergeWatchedRows([],dir)
 assert.equal(rows.length,1)
 assert.equal(readFileSync(join(dir,'seen.md'),'utf8'),before)
})
test('无文件时返回空列表，错误的 BV 不计入',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'out','2026-10-24.md'),`### BV123\n`)
 assert.deepEqual(mergeWatchedRows([],dir),[])
})

test('旧主人推荐的「值得看」即使旧 picked=true，也不得成为兴趣自主选看证据',t=>{
 const dir=fixture(t)
 const rows=mergeWatchedRows([{day:'2026-10-24',bvid:BV1,title:'远古生物讲座',status:'值得看',picked:true}],dir)
 assert.equal(rows[0].picked,true) // preserve legacy recommendation behaviour
 assert.equal(rows[0].autonomousSelected,false)
})
test('日报中明确挑中才是独立兴趣证据，不把普通归档当自主选择',t=>{
 const dir=fixture(t)
 writeFileSync(join(dir,'out','2026-10-24.md'),`### ${BV2}\n标题：远古生物讲座\n`)
 const rows=mergeWatchedRows([{day:'2026-10-24',bvid:BV1,title:'远古生物讲座',status:'可以看',picked:true}],dir)
 assert.equal(rows.find(x=>x.bvid===BV1).autonomousSelected,false)
 assert.equal(rows.find(x=>x.bvid===BV2).autonomousSelected,true)
})
