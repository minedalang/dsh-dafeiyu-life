import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const b = (p) => readFileSync(resolve(root, p));
test('Windows CMD launcher and its referenced path are ASCII-only', () => {
  const compat = b('tools/抓取窗口与私信视觉诊断.bat');
  const ascii = b('tools/capture-window-dm-vision.bat');
  const powershell = b('tools/capture-window-dm-vision.ps1');
  for (const file of [compat, ascii, powershell]) assert.ok(file.every(x => x < 128), 'non-ASCII byte in startup path');
  assert.match(compat.toString('ascii'), /capture-window-dm-vision\.bat/);
  assert.match(ascii.toString('ascii'), /-File "%~dp0capture-window-dm-vision\.ps1"/);
  assert.match(powershell.toString('ascii'), /param\(\[string\]\$Uid/);
  assert.match(powershell.toString('ascii'), /No raw stderr/);
});
test('Original PowerShell script declares UTF-8 BOM for PS 5.1', () => {
  assert.deepEqual([...b('tools/抓取窗口与私信视觉诊断.ps1').subarray(0,3)], [0xef, 0xbb, 0xbf]);
});
