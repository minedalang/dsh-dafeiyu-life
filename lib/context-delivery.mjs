/**
 * Prompt-only delivery metadata. This is NOT a memory, a second audit ledger,
 * a privacy decision, or evidence that the model understood a source.
 * Never use these helpers for permissions, receipts or authoritative records.
 */
import {boundedJson,boundedText} from './context-budget.mjs'

const SCENES=new Set(['life-voice','read-only-world','verified-experience','candidate-evidence','recent-verified-read'])
const itemCount=value=>Array.isArray(value)?value.length:
  value&&typeof value==='object'?Object.keys(value).length:
  value===null||value===undefined||value===''?0:1
const chars=value=>String(value??'').length
const capCount=n=>Math.min(10000,Math.max(0,n))
const capChars=n=>Math.min(1_000_000_000,Math.max(0,n))

function report({scene,source,delivered,sourceText,unavailable=false,format}){
  const status=unavailable?'unavailable':sourceText===delivered?'complete':'partial'
  const sourceItems=itemCount(source)
  let deliveredItems=0
  if(!unavailable){
    if(format==='json'){
      try{deliveredItems=itemCount(JSON.parse(delivered))}catch{}
    }else deliveredItems=delivered?1:0
  }
  return Object.freeze({
    schema:'life-context-delivery/v1',scene:SCENES.has(scene)?scene:'unknown',status,
    sourceCounts:{items:capCount(sourceItems)},includedCounts:{items:capCount(deliveredItems)},
    sourceChars:capChars(chars(sourceText)),includedChars:capChars(chars(delivered)),
    omissionReasons:unavailable?['context-unavailable']:status==='partial'?['bounded-context']:[],
    missingCriticalEvidence:sourceItems>0&&(unavailable||deliveredItems===0),
    rawContentStored:false
  })
}

export function deliverJsonContext(value,maxChars,{scene='unknown'}={}){
  const text=boundedJson(value,maxChars)
  let sourceText='',unavailable=false
  try{sourceText=JSON.stringify(value??null)}catch{unavailable=true}
  try{unavailable=unavailable||!!JSON.parse(text)?.contextUnavailable}catch{unavailable=true}
  return {text,report:report({scene,source:value,delivered:text,sourceText,unavailable,format:'json'})}
}

export function deliverTextContext(value,maxChars,{scene='unknown'}={}){
  const original=String(value??''),text=boundedText(original,maxChars)
  return {text,report:report({scene,source:original,delivered:text,sourceText:original,format:'text'})}
}

/** Short, content-free status for inclusion in the exact model input. */
export function contextDeliveryNotice(reports){
  const partial=(Array.isArray(reports)?reports:[]).filter(r=>r?.status!=='complete')
  if(!partial.length)return ''
  // All scenes and reasons come from this module's fixed contract, not model
  // output or privately sourced text. Never include excerpts or source IDs.
  return '【上下文范围提示】'+partial.map(r=>`${r.scene}:${r.status}（实际输入${r.includedChars}/${r.sourceChars}字）`).join('；')+
    '。未进入本轮模型的内容未知，不得推断已阅读或已核验；必要时自主延期并按现有权限补读。'
}
