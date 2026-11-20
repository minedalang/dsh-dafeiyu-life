import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync,readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname,join} from 'node:path'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const artifact=/^(?:TESTING_.*\.md|TEST-RESULTS.*\.md|COMMIT_MESSAGE\.txt|APPLY\.md|README-交付说明\.md|README-#U.*\.md)$/

test('root source does not contain historic release delivery artifacts',()=>{
  const debris=readdirSync(root).filter(name=>artifact.test(name))
  assert.deepEqual(debris,[],'delivery files belong beside source/ in ZIP, not inside the Git repository')
})
test('future root delivery files are blocked from Git and npm packaging',()=>{
  const git=readFileSync(join(root,'.gitignore'),'utf8')
  const npm=readFileSync(join(root,'.npmignore'),'utf8')
  for(const rule of ['/TESTING_*.md','/TEST-RESULTS*.md','/COMMIT_MESSAGE.txt',
    '/APPLY.md','/README-交付说明.md','/README-#U*.md']){
    assert.ok(git.split(/\r?\n/).includes(rule),'missing Git ignore '+rule)
    assert.ok(npm.split(/\r?\n/).includes(rule),'missing npm ignore '+rule)
  }
  const packageFiles=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).files
  assert.ok(!packageFiles.some(name=>artifact.test(name)))
})
