import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('quota screen reads measured Python ledger, never estimates total bandwidth',()=>{
  const html=read('lib/management-console.html');
  const client=read('lib/management-console.js');
  const host=read('index.js');
  assert.match(html,/次数与额度/);
  assert.match(html,/并非每日流量上限/);
  assert.match(client,/每条 Episode 共享上限/);
  assert.match(html,/不含历史旧版、Whisper 音频和其他 B站请求/);
  assert.match(client,/request\('\/video-vision-traffic'\)/);
  assert.match(client,/视频视觉流量 · 今日/);
  assert.match(client,/视频视觉流量 · 累计/);
  assert.match(client,/traffic\.categories/);
  assert.match(host,/path === '\/api\/bili-duty\/video-vision-traffic'/);
  assert.match(host,/lib','video_traffic\.py'/);
  assert.doesNotMatch(host,/traffic.*secret|traffic.*Cookie/);
});

test('video traffic script is deployed and deployment consistency is guarded',()=>{
  assert.match(read('lib/state.mjs'),/video_traffic\.py/);
  assert.match(read('index.js'),/流量统计脚本版本不一致/);
  const python=read('lib/video_traffic.py');
  assert.match(python,/sqlite3\.connect/);
  assert.match(python,/count_bytes/);
  assert.doesNotMatch(python,/bvid|cookie|upsig|url\s*=/i);
});
