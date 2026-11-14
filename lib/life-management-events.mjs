/** Local-only management change hints. No state, identifiers or private content in the stream. */
const VALID=new Set(['life','plans','timeline'])
export function createLifeManagementEvents({heartbeatMs=25000}={}){
  let revision=0,closed=false
  const clients=new Set()
  const publish=(kind='life')=>{
    if(closed||!VALID.has(kind))return
    revision++
    const event=`id: ${revision}\nevent: life-change\ndata: ${JSON.stringify({kind})}\n\n`
    for(const res of clients){try{res.write(event)}catch{clients.delete(res)}}
  }
  const subscribe=(req,res)=>{
    if(closed){res.writeHead(503);res.end();return}
    if(clients.size>=8){res.writeHead(429);res.end();return}
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no','x-content-type-options':'nosniff'})
    res.write(`retry: 2500\nevent: ready\ndata: {}\n\n`)
    clients.add(res)
    const heartbeat=setInterval(()=>{try{res.write(': alive\n\n')}catch{cleanup()}},heartbeatMs)
    heartbeat.unref?.()
    let cleaned=false
    function cleanup(){if(cleaned)return;cleaned=true;clearInterval(heartbeat);clients.delete(res)}
    // IncomingMessage 'close' can fire when GET body completes, before an SSE
    // response closes. Listen for actual abort/response close instead.
    req.on('aborted',cleanup);res.on('close',cleanup);res.on('error',cleanup)
  }
  const close=()=>{closed=true;for(const r of clients){try{r.end()}catch{}}clients.clear()}
  return {publish,subscribe,close,get connected(){return clients.size}}
}
