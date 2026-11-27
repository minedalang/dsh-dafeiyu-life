import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const html=src('lib/management-console.html'),ui=src('lib/management-console.js')

test('graph search is immediately above its 3D viewport in the same field, including fullscreen',()=>{
 const a=html.indexOf('<div class="neural-recall-field">')
 const b=html.indexOf('id="neural-memory-viewport"',a)
 const fragment=html.slice(a,b)
 assert.ok(a>=0&&b>a)
 assert.match(fragment,/id="neural-search-input"/)
 assert.match(fragment,/id="neural-search-apply"/)
 assert.match(fragment,/class="neural-canvas-legend"/);assert.match(fragment,/neural-legend|neural-recall-controls/)
 assert.equal((html.match(/id="neural-search-input"/g)||[]).length,1)
 assert.match(ui,/neuralBoard\.requestFullscreen/)
})

test('old duplicate plan flow is gone and functional admin tools are tabs, not three stacked pages',()=>{
 assert.doesNotMatch(html,/class="life-source-flow"|class="todo-page-intro"/)
 for(const id of ['life-plan-hub-grid','life-plan-admin','life-todo-section','owner-todo-list','life-opportunities-section','owner-todo-add','owner-todo-settings-save'])
  assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1)
 assert.match(html,/data-life-plan-open="todo"/)
 assert.match(html,/data-life-plan-open="source"/)
 assert.match(html,/id="life-opportunities-section"[^>]*hidden/)
 assert.match(ui,/showLifePlanTool/)
 assert.match(ui,/todo\.hidden=normalized!=='todo';source\.hidden=normalized!=='source'/)
 assert.match(ui,/\('owner-todo-add'\)\.addEventListener/)
})

test('all neural legend controls are adjacent to viewport; long evidence has its own scroll and cannot size canvas',()=>{
 const a=html.indexOf('class="neural-canvas-legend"'),b=html.indexOf('id="neural-memory-viewport"',a),fragment=html.slice(a,b);assert.ok(a>0&&b>a);
 for(const id of ['neural-show-all','neural-node-limit','neural-show-interest','neural-show-relationship','neural-show-source','neural-show-association','neural-show-emotion','neural-filter-experience','neural-filter-relationship','neural-filter-interest','neural-filter-fact','neural-filter-emotion','neural-association-types']){assert.ok(fragment.includes(`id="${id}"`),id);assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id)}
 assert.match(html,/\.neural-recall-layout\{position:relative;align-items:stretch;[^}]+grid-template-columns:minmax\(0,1fr\) minmax\(240px,26%\)/);assert.match(html,/\.neural-memory-viewport\{flex:1 1 0;min-height:0;height:auto/);assert.match(html,/\.neural-memory-detail\{margin:0;flex:1 1 0;[^}]+overflow:auto/);assert.match(html,/\.neural-relation-list\{display:grid;grid-template-columns:minmax\(0,1fr\)/);assert.match(fragment,/青色光束 · 本次搜索相似度/);assert.match(fragment,/灰点 · 未命中/)
})

test('neural line legend nests all six definitions and hit geometry handles crossings and zoom',async()=>{
 const a=html.indexOf('class="neural-edge-legend"'),b=html.indexOf('</section>',a),fragment=html.slice(a,b);assert.ok(fragment.includes('class="neural-association-group"'));assert.ok(fragment.indexOf('id="neural-show-association"')<fragment.indexOf('id="neural-association-types"'));
 for(const key of ['similarity','context','concept','contrast','temporal','emotion'])assert.ok(fragment.includes(`data-association-count="${key}"`));assert.equal((fragment.match(/class="neural-type-definition"/g)||[]).length,6);assert.match(fragment,/情绪回声只连接经历与当时情绪/);assert.match(fragment,/本次搜索相似度/);
 const {runInNewContext}=await import('node:vm');const code=ui.slice(ui.indexOf('  const neuralSegmentDistance='),ui.indexOf('  const showNeuralRelation='));const hit=runInNewContext(code+'\nneuralLineHits');const aLine={a:{x:0,y:0},b:{x:100,y:100}},bLine={a:{x:0,y:100},b:{x:100,y:0}},other={a:{x:200,y:200},b:{x:300,y:300}};
 assert.equal(hit([aLine,bLine,other],50,50,1).length,2);assert.equal(hit([aLine],50,59,2).length,0);assert.equal(hit([aLine],50,59,.5).length,1);assert.equal(hit([],50,50,1).length,0);assert.equal(hit([aLine],-30,-30,1).length,0);
 assert.match(ui,/neuralHitLines\.push\(\{edge:e,a,b\}\)/);assert.match(ui,/neuralLineHits\(\[\.\.\.neuralHitLines,\.\.\.neuralBeamHits\]/);assert.match(ui,/input\.disabled=!\$\('neural-show-association'\)\.checked/);assert.match(ui,/showNeuralLineChoices\(hits\)/);
})


test('canvas-first fullscreen workspace keeps collapsible controls and relation inspector in the same board',()=>{
 assert.match(html,/id="neural-legend-toggle"[^>]*aria-controls="neural-canvas-controls"/);assert.match(html,/id="neural-side-toggle"[^>]*aria-controls="neural-recall-inspector"/)
 assert.match(html,/id="neural-association-options"><summary>6类联想/);assert.match(html,/\.neural-recall-board\.is-compact-controls \.neural-canvas-legend\{position:absolute/)
 assert.match(html,/\.neural-recall-board:fullscreen,.*?\.neural-recall-board\.is-expanded\{box-sizing:border-box;overflow:hidden!important/)
 assert.match(ui,/fitNeuralView\(\);renderNeuralScene\(\)/);assert.match(ui,/neural-dialog-endpoints/);assert.match(ui,/neural-dialog-metrics/);assert.match(ui,/dialog\.close\(\);neuralDetail\(m\.id\);setNeuralInspector\(true\)/)
})
test('activation overlay only draws a loaded typed association path with enabled filters; no synthetic no-query ray',async()=>{
 const {runInNewContext}=await import('node:vm');const a=ui.indexOf('  const neuralActivationDrawable='),b=ui.indexOf('  const playNeuralActivation=',a)
 const edge={type:'association',associationType:'concept',from:'a',to:'b'};const context={$:()=>({checked:true}),neuralScene:{positions:new Map([['a',{}],['b',{}]])},neuralEdges:[edge],neuralAssociationEnabled:()=>true}
 const draw=runInNewContext(ui.slice(a,b)+'\nneuralActivationDrawable',context)
 const step={from:'b',to:'a',associationType:'concept'};assert.equal(draw([step]),true);assert.equal(draw([{...step,associationType:'contrast'}]),false);assert.equal(draw([{...step,from:'unloaded'}]),false);assert.equal(draw([]),false)
 context.neuralAssociationEnabled=()=>false;assert.equal(draw([step]),false);context.neuralAssociationEnabled=()=>true;context.$=()=>({checked:false});assert.equal(draw([step]),false)
 assert.doesNotMatch(ui,/animateNeuralSignal/);assert.match(ui,/request\('\/main-session\/memory\/neural\/activation'\+\(selected\?/)
})


test('recent mode keeps only a real path, respects filters and expiry; full graph is independent',async()=>{
 const {runInNewContext}=await import('node:vm');
 assert.match(html,/<select id="neural-view-mode"[^>]*><option value="recent" selected>/)
 const scene=ui.slice(ui.indexOf('  const renderNeuralScene='),ui.indexOf('  const drawNeuralMemory='));assert.match(scene,/const fullGraph=\$\('neural-view-mode'\)\.value==='graph'/);assert.equal((scene.match(/if\(!showType\[e\.type\]/g)||[]).length,2);assert.equal((scene.match(/fullGraph&&hit&&m\.emotion/g)||[]).length,2);assert.match(scene,/drawRecentNeuralActivation\(\)/)
 const a=ui.indexOf('  let neuralActivationToken='),b=ui.indexOf('  const sceneSVG=neuralViewport;',a);
 const edge={type:'association',associationType:'concept',from:'a',to:'b'},steps=[{from:'a',to:'b',associationType:'concept'}],activation={id:'real',at:1000,steps};let now=1000,elapsed=0,children=[],callbacks=[],expiry=null,visible=true,mode='recent',response={activation},reloads=0;const status={};
 const group={replaceChildren(){children=[]},append(...items){children.push(...items)}};const els={'neural-activation-path':group,'neural-activation-status':status,'neural-view-mode':{get value(){return mode},set value(v){mode=v},addEventListener(){}},'neural-show-association':{get checked(){return visible}},'neural-activation-replay':{addEventListener(){}},'main-session-history-query':{value:''}};
 const context={platformSettingsUnavailable:()=>false,localEmbeddingEnabled:true,$:id=>els[id],neuralScene:{positions:new Map([['a',{x:0,y:0}],['b',{x:10,y:0}]])},neuralEdges:[edge],neuralAssociationEnabled:()=>true,neuralAssociationColors:{concept:'#00aabb'},neuralRequestVersion:1,document:{hidden:false},window:{matchMedia:()=>({matches:false})},performance:{now:()=>elapsed},Date:{now:()=>now},requestAnimationFrame:fn=>callbacks.push(fn),setTimeout:fn=>{expiry=fn;return 1},clearTimeout(){expiry=null},svgEl:(tag,props)=>({tag,props,style:{}}),request:async()=>response,formatLocalTime:()=>'',renderNeuralScene(){},renderNeuralMemory(){reloads++}};
 const f=runInNewContext(ui.slice(a,b)+'\n({refreshNeuralActivation,drawRecentNeuralActivation,clearNeuralActivation})',context);
 await f.refreshNeuralActivation();assert.equal(children.length,0);elapsed=800;callbacks.shift()();assert.equal(children.filter(x=>x.tag==='line').length,1);assert.equal(callbacks.length,0);
 elapsed=6000;f.drawRecentNeuralActivation();assert.equal(children.filter(x=>x.tag==='line').length,1,'path remains after animation');
 mode='graph';f.drawRecentNeuralActivation();assert.equal(children.length,0);mode='recent';visible=false;f.drawRecentNeuralActivation();assert.equal(children.length,0);visible=true;f.drawRecentNeuralActivation();assert.equal(children.length,3);
 expiry();assert.equal(children.length,0);assert.match(status.textContent,/暂无/);response={activation:null};await f.refreshNeuralActivation();assert.equal(children.length,0);
 response={activation:{...activation,id:'instant',mode:'immediate',steps:[{from:'a',to:'b',associationType:'immediate'}]}};await f.refreshNeuralActivation();elapsed+=800;callbacks.shift()();assert.equal(children.filter(x=>x.tag==='line').length,1);assert.equal(children.find(x=>x.tag==='line').style.strokeDasharray,'7 5');assert.match(status.textContent,/即时联想（临时）/);assert.equal(reloads,0);mode='graph';f.drawRecentNeuralActivation();assert.equal(children.length,0);mode='recent';f.clearNeuralActivation();
 response={activation:{...activation,id:'new-edge',steps:[{from:'a',to:'c',associationType:'concept'}]}};await f.refreshNeuralActivation();assert.equal(reloads,1);await f.refreshNeuralActivation();assert.equal(reloads,1);assert.equal(children.length,0);
})
