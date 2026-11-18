#!/usr/bin/env node
/** Idempotent local Git hook bootstrap. Never replace an unrelated existing hook. */
import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join,isAbsolute} from 'node:path';

const rootDefault=resolve(fileURLToPath(new URL('..',import.meta.url)));
function git(root,args) {
  const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
  return r.error||r.status!==0?null:r.stdout.trim();
}
export function installHooks(root=rootDefault,{quiet=false}={}) {
  const messages=[];
  const say=s=>{messages.push(s);if(!quiet)(process.env.npm_lifecycle_event==='prepare'?console.error:console.log)('[test-governance] '+s);};
  if(!existsSync(join(root,'.git'))) {say('Not a repository checkout; hook installation skipped.');return {status:'not-repo',messages};}
  const repo=git(root,['rev-parse','--show-toplevel']);
  if(!repo||resolve(repo)!==resolve(root)) {say('Repository root could not be confirmed; hook installation skipped.');return {status:'not-repo',messages};}
  if(!existsSync(join(root,'.githooks','pre-commit'))) throw Error('Tracked .githooks/pre-commit is missing');
  const current=git(root,['config','--local','--get','core.hooksPath']);
  if(current) {
    const target=isAbsolute(current)?resolve(current):resolve(root,current);
    if(target===resolve(root,'.githooks')) {say('Git hooks are already active.');return {status:'installed',messages};}
    say(`Custom core.hooksPath (${current}) is in use; preserving it. CI will enforce governance.`);
    return {status:'custom-hooks',messages};
  }
  const hookDir=git(root,['rev-parse','--git-path','hooks']);
  if(!hookDir) {say('Cannot locate Git hooks directory.');return {status:'unavailable',messages};}
  const actual=isAbsolute(hookDir)?hookDir:resolve(root,hookDir);
  const old=join(actual,'pre-commit');
  if(existsSync(old)) {
    let content='';try{content=readFileSync(old,'utf8');}catch{}
    if(content.trim()) {
      say('A local pre-commit hook already exists; preserving it. CI will enforce governance.');
      return {status:'existing-hook',messages};
    }
  }
  const set=spawnSync('git',['config','--local','core.hooksPath','.githooks'],{cwd:root,encoding:'utf8',windowsHide:true});
  if(set.status!==0) throw Error('Cannot enable tracked Git hooks: '+String(set.stderr||set.error?.message));
  say('Git pre-commit governance enabled automatically (fast checks only).');
  return {status:'installed-now',messages};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{installHooks();}catch(e){console.error('[test-governance] '+e.message);process.exitCode=1;}
}
