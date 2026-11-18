#!/usr/bin/env node
/** Test lifecycle contract: inventory, safety anchors, deliberate archiving and impact review. */
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const namePattern = /^[A-Za-z0-9_-]+\.test\.mjs$/;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const list = dir => existsSync(dir) ? readdirSync(dir).filter(x => namePattern.test(x)).sort() : [];
const pythonPattern = /^test[A-Za-z0-9_-]*\.py$/;
const pythonList = dir => existsSync(dir) ? readdirSync(dir).filter(x => pythonPattern.test(x)).sort() : [];
const isText = x => typeof x === 'string' && x.trim().length >= 16;

export function validateCatalog(root = projectRoot) {
  const errors = [];
  let catalog;
  try { catalog = JSON.parse(readFileSync(join(root, 'test/governance/catalog.json'), 'utf8')); }
  catch (e) { return { ok:false, errors:['Cannot read test governance catalog: '+e.message] }; }
  const active = list(join(root,'test'));
  const archived = list(join(root,'test/legacy'));
  const python = pythonList(join(root,'test'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.baselineActive) ||
    !catalog.registeredActive || typeof catalog.registeredActive !== 'object' ||
    !catalog.archived || typeof catalog.archived !== 'object' || !Array.isArray(catalog.protected) ||
    !Array.isArray(catalog.baselinePython) || !catalog.registeredPython || !Array.isArray(catalog.pythonProtected) ||
    !Array.isArray(catalog.retiredAssertions)) {
    return {ok:false,errors:['Catalog schema is invalid']};
  }
  const registered = Object.keys(catalog.registeredActive);
  const baseline = catalog.baselineActive;
  const expectedActive = [...baseline, ...registered];
  const expectedPython = [...catalog.baselinePython, ...Object.keys(catalog.registeredPython)];
  const dedupe = xs => new Set(xs).size === xs.length;
  if (!dedupe(expectedActive)) errors.push('Duplicate active test registration');
  if (!dedupe(expectedPython)) errors.push('Duplicate Python test registration');
  if (!dedupe(catalog.protected)) errors.push('Duplicate safety anchor');
  if (!dedupe(Object.keys(catalog.archived))) errors.push('Duplicate archived test registration');
  for (const n of [...expectedActive, ...Object.keys(catalog.archived), ...catalog.protected]) {
    if (!namePattern.test(n)) errors.push('Invalid test filename: '+n);
  }
  for (const name of active) if (!expectedActive.includes(name)) errors.push('Unregistered active test: '+name);
  for (const name of expectedActive) if (!active.includes(name)) errors.push('Registered active test missing: '+name);
  for (const name of python) if (!expectedPython.includes(name)) errors.push('Unregistered Python test: '+name);
  for (const name of expectedPython) if (!python.includes(name)) errors.push('Registered Python test missing: '+name);
  for (const name of catalog.pythonProtected) if (!python.includes(name)) errors.push('Protected Python safety test missing: '+name);
  for (const name of archived) if (!hasOwn(catalog.archived,name)) errors.push('Unreviewed legacy test: '+name);
  for (const name of Object.keys(catalog.archived)) if (!archived.includes(name)) errors.push('Archived test missing: '+name);
  for (const name of catalog.protected) {
    if (!active.includes(name)) errors.push('Protected security/architecture test must remain active: '+name);
    if (hasOwn(catalog.archived,name)) errors.push('Cannot archive protected test: '+name);
  }
  const highRisk = /(?:security|symlink|identity|account-switch|transaction|permission|privacy|outbound|read-gate|write-gate|receipt|recovery|crosslang|integrity|rate-limit|mcp.*gate)/i;
  for (const [name, meta] of Object.entries(catalog.archived)) {
    if (!isText(meta?.reason) || !isText(meta?.replacement) || !/^\d{4}-\d{2}-\d{2}$/.test(meta?.date ?? '')) errors.push('Archived test requires reason, replacement, date: '+name);
    if (highRisk.test(name)) errors.push('High-risk test may not be archived without rewriting active invariant coverage: '+name);
  }
  for (const item of catalog.retiredAssertions) {
    const file = join(root,'test',String(item.file||''));
    if (!namePattern.test(item.file??'') || !existsSync(file) || !isText(item.reason) || !item.oldCheck || !item.newCheck || !/^\d{4}-\d{2}-\d{2}$/.test(item.date??'')) {
      errors.push('Retired assertion requires active file, old/new contract, reason and date: '+String(item.file));
      continue;
    }
    const source = readFileSync(file,'utf8');
    if (source.includes(item.oldCheck)) errors.push('Retired assertion still active: '+item.file);
    if (!source.includes(item.newCheck)) errors.push('Retired assertion replacement missing: '+item.file);
  }
  for (const [name, meta] of Object.entries(catalog.registeredPython)) {
    if (!pythonPattern.test(name) || !isText(meta?.intent) || !meta?.owner || !['behavior','contract','ui','security'].includes(meta?.kind)) errors.push('New Python test requires owner, kind and test intent: '+name);
  }
  for (const [name, meta] of Object.entries(catalog.registeredActive)) {
    if (!isText(meta?.intent) || !meta?.owner || !['behavior','contract','ui','security'].includes(meta?.kind)) errors.push('New test requires owner, kind and test intent: '+name);
  }
  return {ok:errors.length===0,errors,stats:{active:active.length,python:python.length,archived:archived.length,protected:catalog.protected.length+catalog.pythonProtected.length,registeredNew:registered.length+Object.keys(catalog.registeredPython).length,retiredAssertions:catalog.retiredAssertions.length}};
}

// Affected-test review is advisory, NOT an excuse to skip any current test.
// It analyses uncommitted changes as well, so maintainers never need to commit first.
export function impactedTests(root = projectRoot, changedFiles = null) {
  if (!changedFiles) {
    const base = flag('base');
    const args = base ? ['diff','--name-only','--diff-filter=ACMR',`${base}...HEAD`] : ['status','--porcelain','-uall'];
    const out = spawnSync('git',args,{cwd:root,encoding:'utf8'});
    if (out.status !== 0) return {changed:[],candidates:[],note:'Git comparison unavailable; pass explicit file paths or verify --base ref.'};
    changedFiles = out.stdout.split(/\r?\n/).filter(Boolean).map(line=>base?line:line.slice(3)).map(x=>x.includes(' -> ')?x.split(' -> ').at(-1):x);
  }
  const changed = [...new Set(changedFiles.map(x=>x.replaceAll('\\','/')).filter(x=>/^(?:lib\/|index\.js$|client\.js$|scripts\/|vendor\/|prompts\/)/.test(x)))].sort();
  const candidates = [];
  for (const file of [...list(join(root,'test')), ...pythonList(join(root,'test'))]) {
    const source = readFileSync(join(root,'test',file),'utf8');
    const matched = changed.filter(x=>source.includes(x) || source.includes(basename(x)));
    if (matched.length) candidates.push({test:file,changed:matched});
  }
  return {changed,candidates,note:'Review affected assertions for behavior changes, stale implementation snapshots and safety coverage; never archive solely to silence a failure.'};
}

function printAudit(root) {
 const a=validateCatalog(root);
 for (const x of a.errors) process.stderr.write('ERROR '+x+'\n');
 if (a.ok) process.stdout.write(`Test governance PASS: ${a.stats.active} Node + ${a.stats.python} Python active, ${a.stats.archived} archived, ${a.stats.protected} protected, ${a.stats.retiredAssertions} retired assertions audited.\n`);
 return a.ok;
}
function flag(key) { const a=process.argv.find(x=>x.startsWith('--'+key+'=')); return a?.slice(key.length+3)??''; }
function runCli() {
 const command=process.argv[2] || 'check';
 if (command==='check') { if (!printAudit(projectRoot)) process.exitCode=1; return; }
 if (command==='impact') {
   const explicit=process.argv.slice(3).filter(x=>!x.startsWith('--'));
   const report=impactedTests(projectRoot,explicit.length?explicit:null);
   const base=flag('base');
   if (flag('require-review')==='1') {
     if (!base || explicit.length) throw Error('Strict PR review requires --base=<merge-base-sha> without explicit paths');
     const out=spawnSync('git',['diff','--name-only','--diff-filter=ACMR',`${base}...HEAD`],{cwd:projectRoot,encoding:'utf8'});
     if (out.status!==0) throw Error('Unable to compare PR base for test review');
     const allChanged=out.stdout.split(/\r?\n/).filter(Boolean);
     const reviewEvidence=allChanged.filter(x=>/^(?:test\/.*\.test\.mjs|test\/test.*\.py|test\/governance\/reviews\/[^/]+\.md)$/.test(x));
     report.reviewEvidence=reviewEvidence;
     if (report.changed.length && !reviewEvidence.length) {
       report.reviewRequired=true;
       process.exitCode=1;
     }
   }
   process.stdout.write(JSON.stringify(report,null,2)+'\n');
   if (report.reviewRequired) process.stderr.write('Production code changed but no test or documented review changed. Update tests, or add a review note under test/governance/reviews/.\n');
   return;
 }
 if (command==='register') {
   const name=process.argv[3], owner=flag('owner'), intent=flag('intent'), kind=flag('kind');
   if (!(namePattern.test(name??'') || pythonPattern.test(name??'')) || !owner || !isText(intent) || !['behavior','contract','ui','security'].includes(kind)) {
     throw Error('Use: register <file.test.mjs> --owner=team --kind=behavior|contract|ui|security --intent="test purpose"');
   }
   const path=join(projectRoot,'test/governance/catalog.json');
   const c=JSON.parse(readFileSync(path,'utf8'));
   if (!existsSync(join(projectRoot,'test',name)) || c.baselineActive.includes(name) || c.registeredActive[name] || c.archived[name] || c.baselinePython.includes(name) || c.registeredPython[name]) throw Error('Test missing or already registered');
   if (pythonPattern.test(name)) c.registeredPython[name]={owner,kind,intent};
   else c.registeredActive[name]={owner,kind,intent};
   writeFileSync(path,JSON.stringify(c,null,2)+'\n');
   if (!printAudit(projectRoot)) process.exitCode=1;
   return;
 }
 if (command==='archive') {
   const name=process.argv[3], reason=flag('reason'), replacement=flag('replacement');
   if (!namePattern.test(name??'') || !isText(reason) || !isText(replacement)) throw Error('Use: archive <file.test.mjs> --reason="specific retired contract" --replacement="current active coverage"');
   const path=join(projectRoot,'test/governance/catalog.json');
   const c=JSON.parse(readFileSync(path,'utf8'));
   if (c.protected.includes(name) || /(?:security|symlink|identity|transaction|privacy|outbound|read-gate|crosslang|integrity|rate-limit)/i.test(name)) throw Error('Protected/high-risk test: rewrite and retain current invariants first');
   if (!c.baselineActive.includes(name) && !c.registeredActive[name]) throw Error('Not an active registered test');
   const from=join(projectRoot,'test',name),to=join(projectRoot,'test/legacy',name);
   if (!existsSync(from) || existsSync(to)) throw Error('Source absent or archive destination already exists');
   // Never archive a file listed in the required quick suite.
   const core=readFileSync(join(projectRoot,'test/current-core-tests.txt'),'utf8').split(/\r?\n/).map(x=>x.trim());
   if (core.includes(name)) throw Error('Quick-gate test: update required suite and invariants before any retirement');
   mkdirSync(join(projectRoot,'test/legacy'),{recursive:true});
   renameSync(from,to);
   c.baselineActive=c.baselineActive.filter(x=>x!==name);
   delete c.registeredActive[name];
   c.archived[name]={reason,replacement,date:new Date().toISOString().slice(0,10)};
   writeFileSync(path,JSON.stringify(c,null,2)+'\n');
   if (!printAudit(projectRoot)) process.exitCode=1;
   return;
 }
 throw Error('Commands: check, impact [files...], register, archive');
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {runCli();} catch(e){console.error('Test governance: '+e.message);process.exitCode=1;}
}
