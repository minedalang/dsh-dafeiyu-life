#!/usr/bin/env node
/** Lightweight, staged-index-aware governance for Git commit hooks. Never mutates the index. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {impactedTests,activeRetiredAssertionReplacement} from './test-governance.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const nodeFile = /^[A-Za-z0-9_-]+\.test\.mjs$/;
const pyFile = /^test[A-Za-z0-9_-]*\.py$/;
const changedTest = /^test\/(?:[^/]+\.test\.mjs|test[^/]*\.py|legacy\/[^/]+\.test\.mjs|governance\/)/;
const production = /^(?:lib\/|index\.js$|client\.js$|scripts\/|vendor\/|prompts\/)/;
const highRisk = /(?:security|symlink|identity|account-switch|transaction|permission|privacy|outbound|read-gate|write-gate|receipt|recovery|crosslang|integrity|rate-limit|mcp.*gate)/i;

function git(root, args, {optional=false}={}) {
  const res = spawnSync('git', args, {cwd:root, encoding:'utf8', maxBuffer:16*1024*1024, windowsHide:true});
  if (res.error || (res.status!==0 && !optional)) throw new Error(`git ${args[0]} failed: ${String(res.stderr||res.error?.message||res.status).trim()}`);
  return res.status===0 ? res.stdout : null;
}
const isText=x=>typeof x==='string' && x.trim().length>=16;
const validMeta=m=>m && typeof m.owner==='string' && m.owner.trim() && isText(m.intent) && ['behavior','contract','ui','security'].includes(m.kind);
const unique=xs=>new Set(xs).size===xs.length;
const dates=x=>/^\d{4}-\d{2}-\d{2}$/.test(x??'');
function stagePaths(root) { return git(root,['ls-files','--cached','-z','--','test']).split('\0').filter(Boolean); }
function stagedFile(root, path) { return git(root,['show',':'+path]); }

/** Check the commit *index*, not loose working files, so partial staging remains reliable. */
export function validateStagedCatalog(root=projectRoot) {
  const errors=[];
  const files=stagePaths(root);
  const indexFiles=new Set(files);
  let cat;
  try {cat=JSON.parse(stagedFile(root,'test/governance/catalog.json'));}
  catch(e){return {ok:false, errors:['Staged governance catalog cannot be read: '+e.message]};}
  // The staged catalog must not quietly erase previously protected anchors or audit history.
  const priorText=git(root,['show','HEAD:test/governance/catalog.json'],{optional:true});
  if(priorText) {
    let prior;
    try { prior=JSON.parse(priorText); } catch { errors.push('Cannot parse prior protected test catalog'); }
    for(const name of prior?.protected??[]) if(!cat.protected?.includes(name)) errors.push('Previously protected Node anchor removed: '+name);
    for(const name of prior?.pythonProtected??[]) if(!cat.pythonProtected?.includes(name)) errors.push('Previously protected Python anchor removed: '+name);
    for(const item of prior?.retiredAssertions??[]) {
      if(!cat.retiredAssertions?.some(x=>x.file===item.file && x.oldCheck===item.oldCheck && x.newCheck===item.newCheck))
        errors.push('Previous retired-assertion audit record was removed: '+item.file);
    }
  }
  if (cat.schemaVersion!==1 || !Array.isArray(cat.baselineActive) || !Array.isArray(cat.baselinePython) ||
      !cat.registeredActive || !cat.registeredPython || !cat.archived || !Array.isArray(cat.protected) ||
      !Array.isArray(cat.pythonProtected) || !Array.isArray(cat.retiredAssertions)) {
    return {ok:false,errors:['Staged catalog schema is invalid']};
  }
  const currentNode=files.filter(x=>/^test\/[^/]+\.test\.mjs$/.test(x)).map(x=>x.slice(5));
  const currentPy=files.filter(x=>/^test\/test[^/]*\.py$/.test(x)).map(x=>x.slice(5));
  const currentArchive=files.filter(x=>/^test\/legacy\/[^/]+\.test\.mjs$/.test(x)).map(x=>x.slice('test/legacy/'.length));
  const wantedNode=[...cat.baselineActive,...Object.keys(cat.registeredActive)];
  const wantedPy=[...cat.baselinePython,...Object.keys(cat.registeredPython)];
  if (!unique(wantedNode)||!unique(wantedPy)||!unique(cat.protected)||!unique(cat.pythonProtected)) errors.push('Duplicate staged registrations');
  for (const [kind,actual,wanted] of [['Node',currentNode,wantedNode],['Python',currentPy,wantedPy],['Archive',currentArchive,Object.keys(cat.archived)]]) {
    const aa=new Set(actual), ww=new Set(wanted);
    for(const n of actual) if(!ww.has(n)) errors.push(`Unregistered staged ${kind} test: ${n}`);
    for(const n of wanted) if(!aa.has(n)) errors.push(`Missing staged ${kind} test: ${n}`);
  }
  for(const n of [...wantedNode,...cat.protected,...Object.keys(cat.archived)]) if(!nodeFile.test(n)) errors.push('Invalid Node filename: '+n);
  for(const n of [...wantedPy,...cat.pythonProtected]) if(!pyFile.test(n)) errors.push('Invalid Python filename: '+n);
  for(const n of cat.protected) {
    if(!currentNode.includes(n)) errors.push('Protected staged Node test missing: '+n);
    if(Object.prototype.hasOwnProperty.call(cat.archived,n)) errors.push('Protected Node test archived: '+n);
  }
  for(const n of cat.pythonProtected) if(!currentPy.includes(n)) errors.push('Protected staged Python test missing: '+n);
  for(const [n,meta] of Object.entries(cat.registeredActive)) if(!validMeta(meta)) errors.push('Invalid staged Node test registration: '+n);
  for(const [n,meta] of Object.entries(cat.registeredPython)) if(!validMeta(meta)) errors.push('Invalid staged Python test registration: '+n);
  for(const [n,meta] of Object.entries(cat.archived)) {
    if(!isText(meta?.reason)||!isText(meta?.replacement)||!dates(meta?.date)) errors.push('Archive needs evidence, replacement, date: '+n);
    if(highRisk.test(n)) errors.push('Cannot archive high-risk test: '+n);
  }
  for(const item of cat.retiredAssertions) {
    if(!nodeFile.test(item.file??'') || !dates(item.date) || !isText(item.reason) || !item.oldCheck || !item.newCheck || !indexFiles.has('test/'+item.file)) {
      errors.push('Invalid staged retired assertion record: '+String(item.file)); continue;
    }
    try {
      const content=stagedFile(root,'test/'+item.file);
      if(content.includes(item.oldCheck)) errors.push('Staged old assertion still present: '+item.file);
      if (!activeRetiredAssertionReplacement(content,item,cat.retiredAssertions)) errors.push('Staged replacement assertion missing: '+item.file);
    } catch(e) {errors.push('Cannot inspect staged retired assertion '+item.file+': '+e.message);}
  }
  return {ok:errors.length===0,errors,stats:{node:currentNode.length,python:currentPy.length,archived:currentArchive.length}};
}

export function commitReview(root=projectRoot) {
  const changed=git(root,['diff','--cached','--name-only','--diff-filter=ACMRD','-z']).split('\0').filter(Boolean);
  const testTouched=changed.some(x=>changedTest.test(x));
  const productionChanged=changed.filter(x=>production.test(x));
  const evidence=changed.filter(x=>/^test\/(?:[^/]+\.test\.mjs|test[^/]*\.py|governance\/reviews\/[^/]+\.md)$/.test(x));
  const staged=testTouched?validateStagedCatalog(root):{ok:true,errors:[]};
  // Impact report is advisory. Requiring a test change for every small commit would be noisy.
  const impacts=productionChanged.length ? impactedTests(root,productionChanged) : {candidates:[]};
  return {ok:staged.ok,errors:staged.errors,changed,productionChanged,evidence,
    candidateTests:impacts.candidates.map(x=>x.test),testsUpdated:!!evidence.length,stagedChecked:testTouched};
}

function main() {
  const mode=process.argv[2]||'pre-commit';
  if(mode==='check-index') {
    const r=validateStagedCatalog();
    for(const err of r.errors) console.error('TEST-GOVERNANCE: '+err);
    if(r.ok) console.log(`Staged governance PASS (${r.stats.node} Node / ${r.stats.python} Python).`);
    else process.exitCode=1;
    return;
  }
  if(mode!=='pre-commit') throw Error('Use pre-commit or check-index');
  const r=commitReview();
  if(!r.changed.length) return;
  if(r.stagedChecked) console.log(`[test-governance] Staged test inventory: ${r.ok?'PASS':'FAIL'}`);
  for(const err of r.errors) console.error('[test-governance] '+err);
  if(r.productionChanged.length) {
    console.log(`[test-governance] ${r.productionChanged.length} production files changed; ${r.candidateTests.length} potentially impacted tests.`);
    if(!r.testsUpdated) console.log('[test-governance] Advisory: update impacted tests or document no-change rationale before PR (CI checks this).');
  }
  if(!r.ok) {console.error('[test-governance] Commit blocked only by staged inventory/security violations.');process.exitCode=1;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {main();}catch(e){console.error('[test-governance] '+e.message); process.exitCode=1;}
}
