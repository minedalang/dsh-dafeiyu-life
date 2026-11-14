import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
test('daily pick quota helper is retired; current video prompt allows unlimited daily selections',()=>{
 assert.equal(existsSync(new URL('../lib/pick-quota.mjs',import.meta.url)),false)
 assert.match(code,/每天.*不设|不再存在每日选片上限|没有每日选片上限|每日选片硬上限已退役/)
 assert.match(code,/status="挑中"/)
})
