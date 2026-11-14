// Portable security-test fixture. An unprivileged Windows account cannot
// necessarily create symlinks. In that case the security assertion is SKIPPED,
// never counted as passed and never replaced with a normal file.
import { symlinkSync } from 'node:fs'

export function symlinkOrSkip(t, target, link, type) {
  try {
    symlinkSync(target, link, type)
    return true
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip('Windows symlink privilege unavailable: rerun security test with Developer Mode or permitted account')
      return false
    }
    throw error
  }
}
