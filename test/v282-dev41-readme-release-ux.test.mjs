import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');

test('2.8.2 highlights describe user benefit on both entry points, without technical jargon',()=>{
  const client=read('client.js'), html=read('lib/management-console.html'), doc=read('README.md');
  for (const value of ['先看视频全貌','看过哪些画面','鱼鱼自己决定看几段'])assert.ok(client.includes(value),value);
  for (const value of ['先看全貌，再看细节','看过什么，有迹可循','鱼鱼可以自己决定看多久'])assert.ok(html.includes(value),value);
  for (const value of ['先看全貌，再看细节','看几段，由鱼鱼自己决定','看过什么，有迹可循'])assert.ok(doc.includes(value),value);
  for (const value of ['多候选视频探索与分镜核验','可回溯的真实观察经历','Life 自主多选与随时停止'])assert.ok(!client.includes(value),value);
  assert.ok(doc.length<12000, 'README is a short product homepage, not a full technical protocol');
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
