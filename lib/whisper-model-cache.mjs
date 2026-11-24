/** Whitelisted, plugin-owned faster-whisper cache management.
 * The caller owns local management-origin authentication. Never operate on an
 * external model path, a symlinked cache root or a directory selected by HTTP.
 */
import {lstatSync, readdirSync, statSync, rmSync, realpathSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {ASR_MODELS} from './video-dependencies.mjs'
import {storageDataPath} from './storage-layout.mjs'
import {largeDataStatus} from './storage-large-data-v2.mjs'

export const whisperRepo = model => ASR_MODELS.includes(model)
  ? `models--Systran--faster-whisper-${model}` : null

function cacheRoot(stateDir) {
  if (!stateDir || !resolve(stateDir)) return null
  const base = resolve(stateDir)
  const v2=largeDataStatus(base)
  const parent = v2.configured?v2.whisperHome:storageDataPath(base,'.hf-cache')
  const hub = join(parent, 'hub')
  // None of the roots may redirect writes/deletion outside the plugin home.
  for (const dir of [base, parent, hub]) {
    try { if (!lstatSync(dir).isDirectory()) return null } catch { return null }
  }
  if (realpathSync(hub) !== hub && resolve(realpathSync(hub)) !== resolve(hub)) return null
  return hub
}
function safeRepo(hub, model) {
  const name = whisperRepo(model)
  if (!hub || !name) return null
  const path = join(hub, name)
  try {
    if (!lstatSync(path).isDirectory() || resolve(realpathSync(path)) !== resolve(path)) return null
  } catch { return null }
  return path
}
function repoBytes(root) {
  let total=0, count=0
  const pending=[root]
  while (pending.length && count<20000) {
    const dir=pending.pop()
    let names=[]
    try { names=readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (++count>20000) break
      const p=join(dir,name)
      try {
        const s=lstatSync(p)
        if(s.isDirectory())pending.push(p)
        else if(s.isFile())total+=s.size
        // Symlink snapshots point at blobs; do not count them twice.
      } catch {}
    }
  }
  return total
}
export function listWhisperModels({stateDir,selectedModel='small',modelPath=''}={}) {
  const hub=cacheRoot(stateDir)
  const rows=[]
  for(const model of ASR_MODELS) {
    const repo=safeRepo(hub,model)
    if(!repo)continue
    let ready=false
    try {
      for(const snap of readdirSync(join(repo,'snapshots')).slice(0,32)) {
        const dir=join(repo,'snapshots',snap)
        if(lstatSync(dir).isDirectory() && statSync(join(dir,'model.bin')).isFile() &&
           statSync(join(dir,'config.json')).isFile()) {ready=true;break}
      }
    }catch{}
    rows.push({model,ready,bytes:repoBytes(repo),selected:!modelPath&&model===selectedModel})
  }
  return {models:rows,externalModelPath:Boolean(modelPath),cacheAvailable:hub!==null}
}
export function deleteWhisperModel({stateDir,model,selectedModel='small',modelPath='',installing=false,
  active=false,confirm,remove=rmSync}={}) {
  if(!whisperRepo(model)||confirm!==`DELETE_WHISPER_${model}`)
    return {ok:false,reason:'invalid-model-or-confirmation'}
  if(installing||active)return {ok:false,reason:'whisper-in-use-or-installing'}
  if(model===selectedModel && !modelPath)return {ok:false,reason:'selected-model-must-switch-first'}
  if(largeDataStatus(stateDir).configured)return {ok:false,reason:'v2-model-delete-disabled-retained-copy-protected'}
  const hub=cacheRoot(stateDir),repo=safeRepo(hub,model)
  if(!repo)return {ok:false,reason:'model-not-in-owned-cache'}
  const size=repoBytes(repo)
  // The only deletion target is one exact whitelisted repo directory inside
  // the verified plugin-owned hub; no free-form path reaches rmSync.
  try {remove(repo,{recursive:true,force:false,maxRetries:0})}
  catch {return {ok:false,reason:'model-cache-delete-failed'}}
  return {ok:true,deletedModel:model,estimatedFreedBytes:size}
}
