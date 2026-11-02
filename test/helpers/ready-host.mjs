/**
 * Business-route integration tests need a completed First Start fixture.
 * This is test-only setup: the production gate and its verification rules stay intact.
 * Do NOT use in onboarding tests, which must exercise the real locked state.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply as productionApply } from '../../index.js'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => existsSync(path) ? readFileSync(path) : Buffer.alloc(0)

export function seedCompletedFirstStart(home) {
  if (typeof home !== 'string' || !home) throw Error('Missing test-only DSH home')
  const stateDir = join(home, 'bili-duty')
  const source = join(home, 'profiles', 'desktop', 'cordis.patch.yml')
  const target = join(home, 'profiles', 'headless', 'cordis.patch.yml')
  const credential = join(stateDir, 'bili_credential.json')
  mkdirSync(stateDir, {recursive:true})
  mkdirSync(join(home, 'profiles', 'desktop'), {recursive:true})
  mkdirSync(join(home, 'profiles', 'headless'), {recursive:true})
  if (!existsSync(source)) writeFileSync(source, '[]\n')
  if (!existsSync(target)) writeFileSync(target, '[]\n')
  if (!existsSync(credential)) writeFileSync(credential, '{"fixture":"test-only"}')
  const fingerprint = sha(Buffer.from(JSON.stringify([
    'desktop', read(source).toString('utf8'), read(join(home, 'cordis.patch.yml')).toString('utf8'), read(target).toString('utf8')
  ])))
  writeFileSync(join(stateDir, 'headless-model-verified.json'), JSON.stringify({version:1,verified:[
    {profile:'desktop', provider:'fixture', model:'fixture-model', fingerprint}
  ]}))
  writeFileSync(join(stateDir, 'first-start-v1.json'), JSON.stringify({
    version:1, welcomeSeen:true, completed:true, skipped:[], biliCredentialHash:sha(read(credential))
  }))
}

export function apply(ctx, config = {}) {
  const homePath = ctx?.get?.('dshHomePath')
  if (typeof homePath !== 'function') throw Error('Business-route test must provide dshHomePath')
  seedCompletedFirstStart(homePath())
  return productionApply(ctx, config)
}
