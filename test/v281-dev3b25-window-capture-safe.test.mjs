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

test('long capture keeps early Q export and avoids Ctrl+C cancellation',()=>{
 assert.match(script,/Console\]::KeyAvailable/);assert.match(script,/KeyChar -eq 'q'/i)
 assert.match(script,/manual-q/);assert.match(script,/console-window-events\.csv/)
})
