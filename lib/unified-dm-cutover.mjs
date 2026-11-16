/** One-time owner inbox migration fence: never replay archived owner messages. */
import {readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs'
import {join} from 'node:path'
export function unifiedOwnerDmCutover(accountRuntimeDir, now=Date.now){
  const path=join(accountRuntimeDir,'unified-life-dm-owner-cutover.json')
  if(existsSync(path)){
    const st=lstatSync(path)
    if(st.isSymbolicLink()||!st.isFile()||st.size>200)throw Error('Life 主人私信迁移围栏不安全')
    const data=JSON.parse(readFileSync(path,'utf8'))
    if(data?.version!==1||!Number.isSafeInteger(data.at)||data.at<1_600_000_000_000||data.at>now()+60_000)
      throw Error('Life 主人私信迁移围栏格式无效')
    return data.at
  }
  const at=now()
  writeFileSync(path,JSON.stringify({version:1,at})+'\n',{flag:'wx',mode:0o600})
  return at
}
