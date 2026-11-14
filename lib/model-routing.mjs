/** DSH headless 模型配置：保持原始字符串，不限制各模型的思考深度写法。 */
export function effectiveModelSelection(selection={}, custom={}, yq=(s)=>JSON.stringify(String(s))) {
  const provider = String(custom.provider || selection?.provider || selection?.providerId || '').trim();
  const model = String(custom.model || selection?.model || selection?.modelId || '').trim();
  const effort = String(Object.prototype.hasOwnProperty.call(custom,'reasoningEffort')?(custom.reasoningEffort??''):(selection?.reasoningEffort||'')).trim();
  if (!provider || !model) {
    if (custom.provider || custom.model || custom.reasoningEffort) throw new Error('缺少可用的 provider/model；请填写模型提供方与模型ID，或设置 DSH 默认模型');
    return [];
  }
  if ([provider,model,effort].some(x=>/[\r\n\0]/.test(x))) throw new Error('模型字段不能包含换行');
  // 支持不同供应商的思考深度写法：普通字符串、数字、布尔值及 JSON 对象/数组。
  let effortYaml = '';
  if (effort) {
    try {
      const parsed=JSON.parse(effort);
      effortYaml=typeof parsed==='string'?yq(parsed):JSON.stringify(parsed);
    } catch {
      if (/^[\[{]/.test(effort)) throw new Error('思考深度 JSON 格式错误');
      effortYaml=yq(effort);
    }
  }
  return ['- id: agent-default-model', '  config:', '    provider: '+yq(provider), '    model: '+yq(model), ...(effortYaml?['    reasoningEffort: '+effortYaml]:[]), ''];
}
