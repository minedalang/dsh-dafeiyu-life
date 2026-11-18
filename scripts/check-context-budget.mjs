#!/usr/bin/env node
/**
 * Prevent a regression to truncating serialized prompt evidence in the middle
 * of a JSON token. Read-only check: it never changes source files. Other
 * bounded strings (IDs, logs, persisted values) require case-by-case review.
 */
import {readFileSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
const files=['index.js']
const walk=(dir)=>{for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){
  const path=join(dir,entry.name)
  if(entry.isDirectory())walk(path)
  else if(/\.(?:mjs|js)$/i.test(entry.name))files.push(path)
}}
walk('lib')
const failures=[]
function serializedPrefixSlice(line){
  // Count the actual JSON.stringify call parentheses, so String(x).slice()
  // *inside* its arguments and .digest('hex').slice() are not false positives.
  let start=0
  while((start=line.indexOf('JSON.stringify(',start))>=0){
    let depth=0, quote='', escaped=false, end=-1
    for(let i=start+'JSON.stringify'.length;i<line.length;i++){
      const c=line[i]
      if(quote){
        if(escaped){escaped=false;continue}
        if(c==='\\'){escaped=true;continue}
        if(c===quote)quote=''
        continue
      }
      if(c==='"'||c==="'"||c==='`'){quote=c;continue}
      if(c==='(')depth++
      else if(c===')'){depth--;if(depth===0){end=i;break}}
    }
    if(end>=0&&/^\s*\.slice\s*\(\s*0\s*,/.test(line.slice(end+1)))return true
    start+=15
  }
  return false
}
for(const name of files){
  const source=readFileSync(join(root,name),'utf8')
  for(const [index,line] of source.split(/\r?\n/).entries()){
    if(serializedPrefixSlice(line))
      failures.push(`${name}:${index+1}: serialized JSON context is cut by .slice(0, ...)`)
  }
}
if(failures.length){
  process.stderr.write(failures.join('\n')+'\nUse boundedJson() for read-only model prompts, never for authority or persistence.\n')
  process.exitCode=1
}else{
  process.stdout.write(`Context budget shape check PASS (${files.length} production JS files; prompt JSON must remain parseable).\n`)
}
