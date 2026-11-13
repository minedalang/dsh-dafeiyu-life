/** Single-decision, model-authored topic state. Never infer an ending from keywords.
 * closed/waiting suppress unsolicited follow-ups, not the next incoming reply. */
export function normalizeTopicState(value) {
  const state=String(value||'').trim().toLowerCase()
  return ['settled','waiting'].includes(state)?state:'open'
}
export function mayUnpromptedContinue(state) {return normalizeTopicState(state)==='open'}
export const TOPIC_STATE_INSTRUCTION='在同一次回复决策中给 topicState:"open|settled|waiting"：open=仍有值得自主延续的独立话题，settled=本轮话题自然说完，waiting=刚提出问题应该等待对方回答。只看实际对话和你本轮表达，不按「谢谢」等字面关键词硬判断。settled/waiting 不阻止未来收到新消息后的正常回复，只停止当前无新消息的续聊。'
