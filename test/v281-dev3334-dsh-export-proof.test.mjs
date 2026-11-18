import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(dirname(fileURLToPath(import.meta.url)))
const source=readFileSync(join(root,'tools','导出B站日志.bat'),'utf8')
test('export preserves safe config layer and failure classification without raw dump',()=>{
 for(const field of ['headlessConfigFailureLayer','headlessConfigFailureKind','headlessConfigDefaultDump','headlessConfigBaseDump']){
   assert.ok(source.includes(`'${field}'`),`export includes ${field}`)
 }
 assert.match(source,/stage\(row\.get\(key\)\)/)
 assert.doesNotMatch(source,/dsh_summary\s*=\s*row/)
})
