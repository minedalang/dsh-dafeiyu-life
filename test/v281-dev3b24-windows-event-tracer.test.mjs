import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const get=name=>readFileSync(new URL(name,root));
test('Windows intermittent console trace is ASCII-only and 5.1-safe',()=>{
 const bat=get('tools/capture-intermittent-window.bat');
 const ps=get('tools/capture-intermittent-window.ps1');
 for(const bytes of [bat,ps])assert.ok(bytes.every(x=>x<128));
 assert.match(bat.toString('ascii'),/capture-intermittent-window\.ps1/);
 const body=ps.toString('ascii');
 assert.match(body,/Win32_ProcessStartTrace/);
 assert.match(body,/Unregister-Event/);
 assert.match(body,/Math]::Min\(3600/);
 assert.match(body,/Get-CimInstance/);
 assert.match(body,/Compress-Archive/);
 assert.doesNotMatch(body,/\$proc\.CommandLine|\$_\.CommandLine|ScreenCapture|clipboard|Get-Content.*config\.json|WriteAllText.*private/i);
});
