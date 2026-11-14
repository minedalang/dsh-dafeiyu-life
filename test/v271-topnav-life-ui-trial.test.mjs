import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=f=>readFileSync(join(root,f),'utf8');
const html=read('lib/management-console.html');
const js=read('lib/management-console.js');
const server=read('index.js');

test('原管理页四组顶部横向导航、页签 ID 均保留，没有注入侧栏',()=>{
  assert.match(html,/<nav class="tabs" aria-label="管理分类">/);
  const start=html.indexOf('<nav class="tabs" aria-label="管理分类">');
  const end=html.indexOf('</nav>',start);
  const tabs=html.slice(start,end);
  assert.equal((tabs.match(/class="tab-cluster"/g)||[]).length,4);
  for(const id of ['home','life-agent','life','relationships','personality','bili','social','comments','dm','dynamic','models','backup'])
    assert.match(tabs,new RegExp(`data-tab="${id}"`));
  assert.doesNotMatch(html,/<aside class="sidebar"|class="mobile-nav"/);
});

test('角色来自本地素材，同源静态资源明确纳入首次设置访问路径',()=>{
  const image=readFileSync(join(root,'lib/assets/deepseek-girl-front.png'));
  assert.deepEqual(image.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  // dev.63 removes the redundant animated fish in Fish Life; keep the one
  // hero character and the separate existing character preview elsewhere.
  assert.equal((html.match(/src="\/api\/bili-duty\/life-character\.png"/g)||[]).length,2);
  assert.match(server,/path==='\/api\/bili-duty\/life-character\.png'/);
  assert.match(server,/join\(pluginDir,'lib','assets','deepseek-girl-front\.png'\)/);
  assert.match(server,/'content-type':'image\/png'/);
});

test('首进 Life 页面即读取时间线，展开和切换范围可再次加载',()=>{
  assert.doesNotMatch(js,/lifeNowTimelineDetails\?\.addEventListener\('toggle'/);
  assert.match(js,/reconcileVisibleLife/);
  assert.match(js,/loadLifeNowTimeline\(\)\.catch\(\(\)=>\{\}\)/);
  assert.match(js,/life-timeline-days'\)\.addEventListener\('change'/);
  assert.match(js,/时间线读取失败，可以点击“刷新列表”重试/);
  assert.match(js,/renderLifeTimeline=async\(\)=>/);
});

test('心情五条曲线和重置按钮作用于真正的 Life 页面，同时遵守低动态偏好',()=>{
  assert.match(html,/#panel-life-agent \.emotion-trend \.trend-line\{fill:none;stroke:var\(--trend-color/);
  assert.match(html,/#panel-life-agent button\.life-amber,#panel-life-agent #emotion-reset/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/\.life-hero-character img\{[^}]*object-fit:contain/);
});
