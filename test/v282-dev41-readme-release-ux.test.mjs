import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');

test('2.8.3 release and video-perception optimization are clear in README, DSH settings and relevant management sections',()=>{
  const client=read('client.js'), html=read('lib/management-console.html'), doc=read('README.md'),history=read('docs/近期版本新功能.md');
  for (const value of ['2.8.3 版本亮点 · 让经历成为记忆','分镜回放、按需补看','神经回忆场、精确搜索','自主联想、反思'])assert.ok(client.includes(value),value);
  for (const value of ['视频观察方式：先了解全貌','选择看得多细','选择上限 · 非强制观看'])assert.ok(html.includes(value),value);
  for (const value of ['先看全貌，再看细节','看几段，由鱼鱼自己决定','看过什么，有迹可循'])assert.ok(history.includes(value),value);
  for (const value of ['多候选视频探索与分镜核验','可回溯的真实观察经历','Life 自主多选与随时停止'])assert.ok(!client.includes(value),value);
  assert.ok(doc.length<12000, 'README is a short product homepage, not a full technical protocol');
  assert.ok(history.includes('2.8.2 重点优化了视频感知流程'));assert.doesNotMatch(doc,/^## 🆕 2\.8\.2 /m)
  assert.match(read('docs/release/RELEASE_NOTES_v2.8.2.md'),/本次重点\*\*优化视频感知流程\*\*/)
  assert.ok(doc.indexOf('## 🌱 未来规划：让生活更有故事')<doc.indexOf('## ❤️ 致谢'));
});

test('three open-platform diagrams remain self-contained honest SVG preview assets',()=>{
  for (const name of ['ecosystem','future-world','roadmap']){
    const svg=read(`docs/architecture/assets/life-open-platform-${name}.svg`);
    assert.match(svg,/<svg[^>]+viewBox=/);assert.match(svg,/<title /);assert.match(svg,/<desc /);
    assert.match(svg,/未来/);assert.doesNotMatch(svg,/(?:href=|xlink:href=)["']https?:\/\//);assert.doesNotMatch(svg,/foreignObject|<script|<image/);
  }
  const doc=read('README.md');
  assert.match(doc,/尚不能连接实际桌宠/);
});

test('ASR diagnosis only displays reported CUDA, CPU or explicit cache, not inferred GPU',()=>{
  const mcp=read('vendor/bilibili-mcp/mcp_server.py'),ui=read('lib/management-console.js');
  assert.match(mcp,/payload\.get\('inferenceDevice'\) in \('cpu','cuda','cache'\)/);
  assert.match(ui,/inferenceDevice==='cuda'/);assert.match(ui,/缓存，本轮未推理/);
});
