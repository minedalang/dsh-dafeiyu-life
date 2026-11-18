/** Wait only for an in-progress Life consideration to settle before a DM model call.
 * This is a bounded read-only hint, not a durable claim, a send grant or a
 * substitute for the original Life admission + platform receipt checks.
 */
const HOLD='life-choice-in-progress'
export async function waitForDmLifeReadiness({inspect,maxWaitMs=6000,pollMs=750,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}={}){
 if(typeof inspect!=='function')return {ok:false,reason:'life-admission-unavailable'}
 const limit=Math.max(0,Math.min(10_000,Number(maxWaitMs)||0))
 const interval=Math.max(25,Math.min(1500,Number(pollMs)||750))
 const started=now()
 let result=inspect()
 while(result?.ok!==true&&result?.reason===HOLD&&now()-started<limit){
  const left=limit-(now()-started)
  if(left<=0)break
  await sleep(Math.min(interval,left))
  result=inspect()
 }
 return result||{ok:false,reason:'life-admission-unavailable'}
}
