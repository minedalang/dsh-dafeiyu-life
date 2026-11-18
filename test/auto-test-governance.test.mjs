import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateStagedCatalog,commitReview} from '../scripts/auto-test-governance.mjs';
import {installHooks} from '../scripts/install-git-hooks.mjs';
const run=(dir,...args)=>{
 const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});
 assert.equal(r.status,0,`git ${args.join(' ')}: ${r.stderr}`);return r.stdout.trim();
};
function sandbox(fn) {
 const root=mkdtempSync(join(tmpdir(),'fish-auto-gov-'));
 try {
  run(root,'init','-q');
  mkdirSync(join(root,'test/governance'),{recursive:true});
  mkdirSync(join(root,'test/legacy'),{recursive:true});
  mkdirSync(join(root,'.githooks'),{recursive:true});
  mkdirSync(join(root,'lib'),{recursive:true});
  writeFileSync(join(root,'.githooks/pre-commit'),'#!/bin/sh\nnode scripts/auto-test-governance.mjs pre-commit\n');
  chmodSync(join(root,'.githooks/pre-commit'),0o755);
  writeFileSync(join(root,'test/security-gate.test.mjs'),'// security gate\n');
  writeFileSync(join(root,'test/feature.test.mjs'),'// replacement-check\n');
  writeFileSync(join(root,'test/test_vision.py'),'# visual contract\n');
  writeFileSync(join(root,'test/legacy/old-snapshot.test.mjs'),'// historical\n');
  writeFileSync(join(root,'lib/action.mjs'),'export const x = 1;\n');
  const c={schemaVersion:1,baselineActive:['security-gate.test.mjs','feature.test.mjs'],registeredActive:{},baselinePython:['test_vision.py'],registeredPython:{},protected:['security-gate.test.mjs'],pythonProtected:['test_vision.py'],archived:{'old-snapshot.test.mjs':{reason:'This exact legacy API was removed.',replacement:'Current behavior contract remains covered.',date:'2026-11-01'}},retiredAssertions:[]};
  writeFileSync(join(root,'test/governance/catalog.json'),JSON.stringify(c));
  run(root,'add','.');
  return fn(root,c);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('pre-commit checks the staged catalog, not loose working-tree contents',()=>sandbox((root,c)=>{
 assert.equal(validateStagedCatalog(root).ok,true);
 writeFileSync(join(root,'test/new-feature.test.mjs'),'// new test');
 run(root,'add','test/new-feature.test.mjs');
 let result=validateStagedCatalog(root);
 assert.equal(result.ok,false);assert.match(result.errors.join(' '),/Unregistered staged Node test/);
 // Not staged: modifying the catalog does not silently bypass commit validation.
 c.registeredActive['new-feature.test.mjs']={owner:'feature',kind:'behavior',intent:'Verify new feature is observable by the user.'};
 writeFileSync(join(root,'test/governance/catalog.json'),JSON.stringify(c));
 assert.equal(validateStagedCatalog(root).ok,false);
 run(root,'add','test/governance/catalog.json');
 assert.equal(validateStagedCatalog(root).ok,true);
}));
test('protected staged tests cannot be removed or archived',()=>sandbox((root,c)=>{
 run(root,'rm','-f','test/security-gate.test.mjs');
 assert.match(validateStagedCatalog(root).errors.join(' '),/Protected staged Node test missing/);
 writeFileSync(join(root,'test/security-gate.test.mjs'),'// security gate\n');
 run(root,'add','test/security-gate.test.mjs');
 c.archived['security-gate.test.mjs']={reason:'Outdated implementation no longer exists.',replacement:'Current gate still must be independently tested.',date:'2026-11-01'};
 writeFileSync(join(root,'test/governance/catalog.json'),JSON.stringify(c));
 run(root,'add','test/governance/catalog.json');
 assert.match(validateStagedCatalog(root).errors.join(' '),/Protected Node test archived/);
}));
test('source-only commits get nonblocking impacted-test advice',()=>sandbox((root)=>{
 // First create an initial commit (fixture has no hook active).
 run(root,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
 writeFileSync(join(root,'lib/action.mjs'),'export const x = 2;\n');
 run(root,'add','lib/action.mjs');
 const result=commitReview(root);
 assert.equal(result.ok,true);
 assert.equal(result.testsUpdated,false);
 assert.deepEqual(result.productionChanged,['lib/action.mjs']);
 assert.equal(result.stagedChecked,false);
}));
test('installer activates tracked hook once without overriding custom paths',()=>sandbox(root=>{
 assert.equal(installHooks(root,{quiet:true}).status,'installed-now');
 assert.equal(run(root,'config','--local','--get','core.hooksPath'),'.githooks');
 assert.equal(installHooks(root,{quiet:true}).status,'installed');
 run(root,'config','--local','core.hooksPath','other-hooks');
 assert.equal(installHooks(root,{quiet:true}).status,'custom-hooks');
 assert.equal(run(root,'config','--local','--get','core.hooksPath'),'other-hooks');
}));
test('installer preserves an unrelated pre-commit hook',()=>sandbox(root=>{
 writeFileSync(join(root,'.git/hooks/pre-commit'),'#!/bin/sh\necho preserve\n');
 assert.equal(installHooks(root,{quiet:true}).status,'existing-hook');
 assert.match(readFileSync(join(root,'.git/hooks/pre-commit'),'utf8'),/preserve/);
 assert.equal(spawnSync('git',['config','--local','--get','core.hooksPath'],{cwd:root}).status,1);
}));

test('real Git commit invokes the hook and blocks an unregistered test',()=>sandbox((root,c)=>{
 mkdirSync(join(root,'scripts'),{recursive:true});
 copyFileSync(new URL('../scripts/auto-test-governance.mjs',import.meta.url),join(root,'scripts/auto-test-governance.mjs'));
 copyFileSync(new URL('../scripts/test-governance.mjs',import.meta.url),join(root,'scripts/test-governance.mjs'));
 run(root,'add','scripts');
 assert.equal(installHooks(root,{quiet:true}).status,'installed-now');
 run(root,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','valid baseline');
 writeFileSync(join(root,'test/not-registered.test.mjs'),'// unregistered\n');
 run(root,'add','test/not-registered.test.mjs');
 const refused=spawnSync('git',['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','bad test'],{cwd:root,encoding:'utf8'});
 assert.notEqual(refused.status,0);
 assert.match(refused.stdout+refused.stderr,/Unregistered staged Node test/);
 c.registeredActive['not-registered.test.mjs']={owner:'tests',kind:'behavior',intent:'Ensure newly registered test files remain covered.'};
 writeFileSync(join(root,'test/governance/catalog.json'),JSON.stringify(c));
 run(root,'add','test/governance/catalog.json');
 run(root,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','registered test');
}));
test('a commit cannot erase protected anchors from its catalog',()=>sandbox((root,c)=>{
 run(root,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline');
 c.protected=[];
 c.pythonProtected=[];
 writeFileSync(join(root,'test/governance/catalog.json'),JSON.stringify(c));
 run(root,'add','test/governance/catalog.json');
 const result=validateStagedCatalog(root);
 assert.equal(result.ok,false);
 assert.match(result.errors.join(' '),/Previously protected Node anchor removed/);
 assert.match(result.errors.join(' '),/Previously protected Python anchor removed/);
}));
