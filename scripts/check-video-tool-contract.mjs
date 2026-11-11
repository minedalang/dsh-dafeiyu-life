/** Static guard against a real dev.58 regression: duty.md prescribed statuses
 * that the MCP's bili_ledger_mark explicitly rejected. No network or AI. */
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {resolve,dirname} from 'node:path'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const duty=readFileSync(resolve(root,'prompts/duty.md'),'utf8')
const mcp=readFileSync(resolve(root,'vendor/bilibili-mcp/mcp_server.py'),'utf8')
const policy=readFileSync(resolve(root,'lib/video-pick-policy.mjs'),'utf8')
const host=readFileSync(resolve(root,'index.js'),'utf8')
function insist(ok,message){if(!ok)throw Error(message)}
insist(/status[^\n]{0,40}挑中/u.test(duty),'duty.md must prescribe exact status=挑中')
insist(/selected\s*=\s*st\s*==\s*['"]挑中['"]/u.test(mcp),'MCP must recognize only the canonical positive state')
insist(/status\s*=\s*['"]挑中['"]/u.test(host),'Host must prescribe the canonical positive state')
insist(/不设入选视频数量上限/u.test(policy),'Daily selection count must not be a hard quota')
// Only ACTUAL argument examples, not warning prose, may be interpreted as
// tool-calling instructions. Reject any example with decorated positive status.
for(const line of duty.split(/\r?\n/u)){
  if(!/bili_ledger_mark/u.test(line))continue
  for(const match of line.matchAll(/status\s*=\s*['"“「]([^'"”」]+)['"”」]/gu)){
    insist(!/^(挑中|已挑中|已入选|入选)[·:：（(\s-]/u.test(match[1]),'Noncanonical status appears in a bili_ledger_mark example')
  }
}
console.log('Video/MCP canonical selection and no-daily-cap contracts OK')
