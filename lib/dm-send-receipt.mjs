/** Extract the platform message key from known MCP tool-result envelopes.
 * Never invent a receipt: an unrecognized success envelope remains uncertain.
 */
export function extractBiliDmReceiptId(value) {
  const seen=new Set();
  const visit=(node,depth=0)=>{
    if(depth>6||node==null)return '';
    if(typeof node==='string'){
      const text=node.trim();
      if(!text||text.length>200_000||(!text.startsWith('{')&&!text.startsWith('[')))return '';
      try{return visit(JSON.parse(text),depth+1)}catch{return ''}
    }
    if(Array.isArray(node)){
      for(const item of node){const found=visit(item,depth+1);if(found)return found;}
      return '';
    }
    if(typeof node!=='object'||seen.has(node))return '';
    seen.add(node);
    for(const key of ['msg_key','message_key','msgKey']){
      const raw=node[key];
      if((typeof raw==='string'||typeof raw==='number')&&String(raw).trim())return String(raw).trim().slice(0,160);
      if(raw&&typeof raw==='object'){
        try{
          const stable=Array.isArray(raw)?raw:Object.fromEntries(Object.entries(raw).sort(([a],[b])=>a.localeCompare(b)));
          const encoded=JSON.stringify(stable);
          if(encoded&&encoded!=='{}'&&encoded!=='[]')return encoded.slice(0,160);
        }catch{}
      }
    }
    for(const key of ['data','structuredContent','content','result','output','text']){
      const found=visit(node[key],depth+1);if(found)return found;
    }
    return '';
  };
  return visit(value);
}
