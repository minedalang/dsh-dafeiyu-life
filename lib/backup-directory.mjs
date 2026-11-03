/** User-chosen backup destination. No OS temporary directories, no secrets, no network paths. */
import { mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { isAbsolute, resolve, parse } from 'node:path'
import { randomUUID } from 'node:crypto'

export function requireBackupDirectory(value, { create = false } = {}) {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input) throw Error('请先在「数据备份」填写并保存备份目录，例如 D:\\大肥鱼备份')
  if (input.length > 420 || input.includes('\0') || !isAbsolute(input))
    throw Error('备份目录必须是本机绝对路径，例如 D:\\大肥鱼备份')
  // Avoid untrusted SMB shares/device paths and writing backups to the disk root.
  if (process.platform === 'win32' && /^\\\\/.test(input))
    throw Error('请使用本机磁盘目录，不支持 UNC 网络共享或设备路径')
  const dir = resolve(input)
  if (dir === parse(dir).root) throw Error('不要直接选择磁盘根目录，请指定单独的备份文件夹')
  if (create) mkdirSync(dir, { recursive: true })
  if (!statSync(dir).isDirectory()) throw Error('备份路径不是文件夹')
  const probe = resolve(dir, `.dafeiyu-write-test-${randomUUID()}`)
  try { writeFileSync(probe, 'ok', { encoding: 'utf8', flag: 'wx' }) }
  catch (e) { throw Error('备份目录不可写：' + String(e?.message || e)) }
  finally { try { rmSync(probe, { force: true }) } catch {} }
  return dir
}

export function saveBackupJson(dir, backup, prefix = 'dafeiyu-backup') {
  if (!['dafeiyu-backup', 'pre-restore', 'dafeiyu-memory', 'pre-memory-restore'].includes(prefix)) throw Error('非法备份名称')
  const validDir = requireBackupDirectory(dir)
  const filename = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`
  const dest = resolve(validDir, filename)
  // Persist to a distinct staging file, read it back and atomically publish
  // only once every byte is present. Never report a partial write as a backup.
  // Never touch or overwrite previously exported backups.
  const staging=resolve(validDir, `.${filename}.${randomUUID()}.partial`)
  const serialized=JSON.stringify(backup)
  try {
    writeFileSync(staging, serialized, {encoding:'utf8',flag:'wx',mode:0o600})
    if(readFileSync(staging,'utf8')!==serialized)throw Error('备份落盘核验失败：文件内容与原始导出不一致')
    JSON.parse(readFileSync(staging,'utf8'))
    renameSync(staging,dest)
  } catch(e) {
    try{rmSync(staging,{force:true})}catch{}
    throw e
  }
  return dest
}
