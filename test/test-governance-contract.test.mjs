import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateCatalog, impactedTests} from '../scripts/test-governance.mjs';

const catalogPath='test/governance/catalog.json';
function fixture(run) {
 const root=mkdtempSync(join(tmpdir(),'fish-test-governance-'));
 try {
   mkdirSync(join(root,'test/governance'),{recursive:true});
   mkdirSync(join(root,'test/legacy'),{recursive:true});
   writeFileSync(join(root,'test','security-gate.test.mjs'),'// protected security behavior\n');
   writeFileSync(join(root,'test','feature.test.mjs'),"import '../lib/action.mjs'\n");
   writeFileSync(join(root,'test','test_security.py'),'# protected Python test\n');
   writeFileSync(join(root,'test/legacy','old-snapshot.test.mjs'),'// v1 snapshot\n');
   const c={schemaVersion:1,baselinePython:['test_security.py'],registeredPython:{},pythonProtected:['test_security.py'],retiredAssertions:[],baselineActive:['security-gate.test.mjs'],registeredActive:{'feature.test.mjs':{owner:'feature',kind:'behavior',intent:'Verify current user-visible product behavior.'}},protected:['security-gate.test.mjs'],archived:{'old-snapshot.test.mjs':{reason:'Only asserted the old release identity.',replacement:'The current release is asserted in current version contracts.',date:'2026-11-01'}}};
   writeFileSync(join(root,catalogPath),JSON.stringify(c,null,2));
   return run(root,c);
 } finally {rmSync(root,{recursive:true,force:true})}
}

test('governance registry refuses unknown tests and missing safety anchors, without hiding current failures',()=>fixture((root,c)=>{
 assert.equal(validateCatalog(root).ok,true);
 writeFileSync(join(root,'test','unreviewed.test.mjs'),'// new\n');
 assert.match(validateCatalog(root).errors.join('\n'),/Unregistered active test/);
 rmSync(join(root,'test','unreviewed.test.mjs'));
 rmSync(join(root,'test','security-gate.test.mjs'));
 assert.match(validateCatalog(root).errors.join('\n'),/Protected security\/architecture/);
 rmSync(join(root,'test','test_security.py'));
 assert.match(validateCatalog(root).errors.join('\n'),/Protected Python safety test missing/);
}));

test('archiving must contain evidence, replacement coverage, and no security migration',()=>fixture((root,c)=>{
 c.archived['old-snapshot.test.mjs'].reason='';
 writeFileSync(join(root,catalogPath),JSON.stringify(c));
 assert.match(validateCatalog(root).errors.join('\n'),/requires reason/);
 c.archived['old-snapshot.test.mjs'].reason='Old release id differs from present published version.';
 c.archived['security-gate.test.mjs']={reason:'Old',replacement:'none',date:'2026-11-01'};
 writeFileSync(join(root,catalogPath),JSON.stringify(c));
 assert.match(validateCatalog(root).errors.join('\n'),/Cannot archive protected test/);
}));

test('impact report detects changed implementation references without requiring a commit',()=>fixture((root)=>{
 const report=impactedTests(root,['lib/action.mjs','docs/release/notes.md']);
 assert.deepEqual(report.changed,['lib/action.mjs']);
 assert.deepEqual(report.candidates.map(x=>x.test),['feature.test.mjs']);
}));
