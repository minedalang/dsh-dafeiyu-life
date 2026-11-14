/**
 * Use an NTFS directory junction on Windows: creating a true directory symlink
 * normally needs Developer Mode or elevated privileges, which regular DSH
 * contributors should not have to enable merely to run security tests.
 *
 * A policy can also prohibit junctions. In that case only the link-injection
 * scenario is skipped, and independent file-path fail-closed tests still run.
 */
import {symlinkSync} from 'node:fs'

export function createUnsafeDirectoryLinkOrSkip(t, target, link){
  try{
    symlinkSync(target, link, process.platform==='win32'?'junction':'dir')
    return true
  }catch(error){
    if(process.platform!=='win32'||!['EPERM','EACCES','ENOTSUP','ENOSYS'].includes(error?.code))throw error
    t.skip(`Windows policy forbids test directory junction (${error.code}); link-injection coverage needs an environment allowing junctions`)
    return false
  }
}
