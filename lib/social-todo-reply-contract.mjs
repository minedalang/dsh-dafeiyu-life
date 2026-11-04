/**
 * Outbound consistency assessment, NOT recommendation intent recognition.
 * Never generates or rewrites a user-facing sentence. The single social model
 * owns willingness, TODO proposals and all outward wording; a verified ledger
 * receipt owns the fact that a recommendation was actually saved.
 */
const affirmative=/(?:记下(?:来|啦|了|咯|喽)?|记住(?:啦|了|了哈)?|收进(?:待办|清单)|加入(?:待办|清单)|放(?:进|入)(?:待办|清单|列表)|(?:已经|都)?安排(?:上|进|好)(?:啦|了)?|已存(?:进|入)(?:待办|清单)|存(?:到|进)(?:待办|清单))/u
const negating=/(?:还没|尚未|没有|并没|未能|没能|不能|无法|尚不能|未成功|不敢说)(?:真正|成功|全部|完全)?(?:记下|记住|加入|放进|安排|存入|存到)/u

export function assessTodoReply({texts=[],todoDisposition='none',intakeResult}={}){
 const lines=(Array.isArray(texts)?texts:[texts]).map(v=>String(v||'')).filter(Boolean)
 if(!lines.some(line=>affirmative.test(line)&&!negating.test(line)))return {ok:true,reason:'no-unverified-commitment'}
 if(todoDisposition==='accept'&&intakeResult?.complete===true)return {ok:true,reason:'verified-durable-todo'}
 return {ok:false,reason:'unverified-todo-commitment'}
}
