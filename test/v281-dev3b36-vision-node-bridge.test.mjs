import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateVisionBridgePacket, launchVisionBridge } from '../lib/dsh-vision-node-bridge.mjs';

const setup = () => {
  const dir=mkdtempSync(join(tmpdir(), 'dsh-vision-bridge-test-'));
  const home=join(dir,'home'), root=join(dir,'desktop');
  mkdirSync(home); mkdirSync(join(root,'resources'),{recursive:true});
  writeFileSync(join(root,'resources','app.asar'),'fake test bundle');
  const exe=join(root,'DeepSeek Harness.exe');
  writeFileSync(exe, '#!/usr/bin/env node\nconsole.log("SAFE_BRIDGE_PROBE_OK")\n');
  chmodSync(exe,0o755);
  const entry=join(root,'resources','app.asar','dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js');
  const patch=join(home,'vision-proof.yml');writeFileSync(patch,'test');
  const env={BILI_DUTY_HOME:home,BILI_VISION_DSH_WORKDIR:dir};
  const packet={exe,argv:['--expose-internals',entry,'--profile','headless','--patch',patch,'--dump-config'],cwd:home,timeoutMs:15000};
  return {dir,home,exe,entry,patch,env,packet};
};

test('Node bridge accepts only trusted Desktop Host + headless/patch', () => {
  const s=setup();
  try {
    assert.equal(validateVisionBridgePacket(s.packet,s.env).argv.at(-1),'--dump-config');
    const malicious = {...s.packet,argv:[...s.packet.argv.slice(0,-1),'--shell']};
    assert.throws(() => validateVisionBridgePacket(malicious,s.env),/bad_operation/);
    assert.throws(() => validateVisionBridgePacket({...s.packet,exe:'/usr/bin/sh'},s.env),/bad_executable/);
    assert.throws(() => validateVisionBridgePacket({...s.packet,cwd:tmpdir()},s.env),/untrusted_workdir/);
    assert.throws(() => validateVisionBridgePacket({...s.packet,argv:[...s.packet.argv,'hello']},s.env),/bad_operation/);
    assert.throws(() => validateVisionBridgePacket({...s.packet,argv:['--expose-internals',s.entry,'--profile','headless','--patch','/tmp/outside.yml','--dump-config']},s.env),/bad_patch/);
  } finally { rmSync(s.dir,{recursive:true,force:true}); }
});

test('Node bridge works without shell and using a fixed, shell-free child command', async () => {
  const s=setup();
  try { assert.equal(await launchVisionBridge(s.packet,{...process.env,...s.env}),0); }
  finally { rmSync(s.dir,{recursive:true,force:true}); }
});
