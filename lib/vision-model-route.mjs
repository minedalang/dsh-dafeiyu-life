/**
 * Canonical DSH visual route resolution.
 * Keep this precedence aligned with the actual Headless overlay:
 * explicit visual route -> plugin-wide default -> current DSH selection.
 */
import {withDefaultModelEffort} from './model-routing.mjs'

const value = x => typeof x === 'string' ? x.trim() : ''
const selected = (selection, a, b) => value(selection?.[a]) || value(selection?.[b])

export function resolveVisionModelRoute(config = {}, selection = {}) {
  const explicitProvider = value(config.visionModelProvider)
  const explicitModel = value(config.visionModelId)
  const defaultProvider = value(config.pluginDefaultModelProvider)
  const defaultModel = value(config.pluginDefaultModelId)
  const hostProvider = selected(selection, 'provider', 'providerId')
  const hostModel = selected(selection, 'model', 'modelId')
  const provider = explicitProvider || defaultProvider || hostProvider
  const model = explicitModel || defaultModel || hostModel
  const reasoningEffort = value(config.visionReasoningEffort) ||
    value(config.videoReasoningEffort) || withDefaultModelEffort(config,{provider,model}).reasoningEffort || ''
  const providerSource = explicitProvider ? 'vision' : defaultProvider ? 'default' : hostProvider ? 'host' : 'missing'
  const modelSource = explicitModel ? 'vision' : defaultModel ? 'default' : hostModel ? 'host' : 'missing'
  const source = providerSource === modelSource ? providerSource :
    providerSource === 'missing' || modelSource === 'missing' ? 'incomplete' : 'mixed'
  return {
    mode: config.visionMode === 'independent_local' ? 'independent_local' : 'independent_dsh',
    provider, model, reasoningEffort, source,
    complete: Boolean(provider && model),
    explicitProvider: Boolean(explicitProvider),
    explicitModel: Boolean(explicitModel),
  }
}
