import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
const script=readFileSync(join(process.cwd(),'tools/capture-intermittent-window.ps1'),'utf8')

test('window trace records only visible console PID/process/class/visibility without titles or command lines',()=>{
 assert.match(script,/EnumWindows/);assert.match(script,/IsWindowVisible/);assert.match(script,/GetClassName/)
 assert.match(script,/ConsoleWindowClass/);assert.match(script,/CASCADIA_HOSTING_WINDOW_CLASS/)
 assert.match(script,/console-window-events\.csv/);assert.match(script,/WindowClass/);assert.match(script,/Visible/)
 assert.doesNotMatch(script,/GetWindowText/);assert.doesNotMatch(script,/CommandLine/);assert.doesNotMatch(script,/GetCommandLine/)
})

test('window trace records bounded Ollama endpoint and startup classifications without raw startup commands',()=>{
 assert.match(script,/ollama-endpoints\.json/)
 assert.match(script,/Get-NetTCPConnection -State Listen.*LocalPort -eq 11434/)
 assert.match(script,/127\.0\.0\.1','\[::1\]'/)
 assert.match(script,/\$request\.Proxy = \$null; \$request\.AllowAutoRedirect = \$false/)
 assert.match(script,/Win32_StartupCommand/)
 assert.match(script,/StartupKinds=\$startup/)
 assert.doesNotMatch(script,/StartupKinds=\$cmd|GetResponseStream/)
})

test('long capture keeps early Q export and avoids Ctrl+C cancellation',()=>{
 assert.match(script,/Console\]::KeyAvailable/);assert.match(script,/KeyChar -eq 'q'/i)
 assert.match(script,/manual-q/);assert.match(script,/console-window-events\.csv/)
})

test('window trace snapshots existing parent processes and resolves owner parent names',()=>{
 assert.match(script,/process-snapshot\.csv/)
 assert.match(script,/Get-CimInstance -ClassName Win32_Process/)
 assert.match(script,/ParentProcess/)
 assert.match(script,/windowScanIntervalMs = 40/)
 assert.match(script,/Start-Sleep -Milliseconds 40/)
 assert.doesNotMatch(script,/MainWindowTitle/)
 assert.doesNotMatch(script,/CommandLine/)
})
