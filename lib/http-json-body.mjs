/** Parse a JSON HTTP request without corrupting multibyte UTF-8 across chunks.
 * A streamed Buffer must be decoded exactly once, after all raw bytes have been
 * received. This is critical for SHA-256 manifests of exported Chinese text.
 * The permissive mode retains the original {} behavior for unrelated APIs;
 * backup imports use strict mode to distinguish malformed/oversized data.
 */
export function readJsonRequest(req, maxBytes=1_000_000, {strict=false}={}) {
  return new Promise((resolve, reject) => {
    const chunks=[]
    let total=0, overflow=false, settled=false
    const complete=(value,error)=>{
      if(settled)return
      settled=true
      if(error && strict)reject(error)
      else resolve(error?{}:value)
    }
    req.on('data', chunk=>{
      if(overflow || settled)return
      const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)
      total+=buffer.length
      if(total>maxBytes){overflow=true;chunks.length=0;return}
      chunks.push(buffer)
    })
    req.on('end',()=>{
      if(overflow)return complete(null, Error('备份上传数据超过大小限制'))
      if(strict && total===0)return complete(null,Error('备份上传内容为空'))
      let decoded
      try {
        const raw=Buffer.concat(chunks,total)
        // Fail closed on invalid UTF-8 rather than silently replacing bytes
        // with U+FFFD and reporting a misleading manifest corruption error.
        decoded=strict?new TextDecoder('utf-8',{fatal:true}).decode(raw):raw.toString('utf8')
      }catch{return complete(null,Error('备份上传 UTF-8 编码无效或文件已损坏'))}
      try{complete(JSON.parse(decoded||'{}'))}
      catch{complete(null,Error('备份 JSON 无法解析；文件可能不完整或已损坏'))}
    })
    req.on('error',()=>complete(null,Error('备份上传连接异常，请重新选择原始备份文件')))
    req.on('aborted',()=>complete(null,Error('备份上传被中断，请重新选择原始备份文件')))
  })
}
