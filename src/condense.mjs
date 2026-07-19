import { resolveVars } from './serialize.mjs'

// Only properties a designer can express in Figma; layout/interaction plumbing is dropped.
const DESIGN_PROP_RE = /^(--v-|color$|background|opacity$|box-shadow$|outline|border|font|letter-spacing$|line-height$|text-transform$|text-decoration|gap$|padding|margin|(min-|max-)?width$|(min-|max-)?height$)/

const STATE_MODIFIERS = ['disabled', 'loading', 'active', 'readonly', 'selected', 'focused', 'error', 'dirty']
const STATE_PSEUDOS = ['hover', 'focus-visible', 'focus', 'active', 'disabled', 'checked', 'focus-within']
const PART_ORDER = ['variant', 'size', 'density', 'modifier', 'state', 'attr', 'combined', 'element', 'child']

function keyParts (entry) {
  const parts = []
  const { modifiers = [], pseudos = [], attributes = [], element, childComponent, combinedWith } = entry.conditions ?? {}
  for (const mod of modifiers) {
    const family = mod.match(/^(variant|size|density)-(.+)$/)
    if (family) parts.push(`${family[1]}:${family[2]}`)
    else if (STATE_MODIFIERS.includes(mod)) parts.push(`state:${mod}`)
    else parts.push(`modifier:${mod}`)
  }
  for (const pseudo of pseudos) {
    const name = pseudo.replace(/^:+/, '').replace(/\(.*\)$/, '')
    if (STATE_PSEUDOS.includes(name)) parts.push(`state:${name}`)
  }
  for (const attr of attributes) parts.push(`attr:${attr}`)
  if (combinedWith) parts.push(`combined:${combinedWith}`)
  if (element) parts.push(`element:${element}`)
  if (childComponent) parts.push(`child:${childComponent}`)

  const unique = [...new Set(parts)]
  unique.sort((a, b) => PART_ORDER.indexOf(a.split(':')[0]) - PART_ORDER.indexOf(b.split(':')[0]))
  return unique
}

function * bucketEntries (buckets) {
  for (const bucket of Object.values(buckets)) {
    if (Array.isArray(bucket)) yield * bucket
    else for (const entries of Object.values(bucket)) yield * entries
  }
}

// Substitutes component-local custom props (e.g. --v-btn-size) defined in the same group.
function resolveLocalVars (value, localVars) {
  return value.replace(/var\(\s*(--v-[\w-]+)\s*\)/g, (match, name) => localVars.get(name) ?? match)
}

function compactValue (raw, localVars, themeVars) {
  const local = resolveLocalVars(raw, localVars)
  const resolved = themeVars ? resolveVars(local, themeVars) : null
  return resolved ? { value: resolved, var: local } : local
}

/**
 * Condenses parser buckets into a flat map:
 * { "base": {prop: value}, "variant:elevated state:hover": {...}, ... }.
 * Cascade collapses per key (later declarations win); non-design props are dropped.
 */
export function condenseBuckets (buckets, themeVars) {
  const groups = new Map()

  const condensable = { ...buckets }
  delete condensable.contextual
  delete condensable.mediaQueries
  delete condensable.forcedColors
  delete condensable.supports

  for (const entry of bucketEntries(condensable)) {
    // context-scoped styling (RTL, other-component containers) stays out of the flat map
    if (entry.conditions?.context || entry.conditions?.contextComponent) continue
    const key = keyParts(entry).join(' ') || 'base'
    const props = groups.get(key) ?? new Map()
    for (const decl of entry.declarations) {
      if (!DESIGN_PROP_RE.test(decl.prop)) continue
      props.set(decl.prop, decl.value)
    }
    if (props.size) groups.set(key, props)
  }

  const out = {}
  for (const [key, props] of groups) {
    const localVars = new Map([...props].filter(([prop]) => prop.startsWith('--')))
    const group = {}
    for (const [prop, value] of props) {
      group[prop] = compactValue(value, localVars, themeVars)
    }
    out[key] = group
  }
  return out
}

function usedInContexts (buckets) {
  const contexts = new Set()
  for (const entry of bucketEntries(buckets)) {
    if (entry.conditions?.contextComponent) contexts.add(entry.conditions.contextComponent)
  }
  return [...contexts].sort()
}

/** Assembles the compact per-component JSON (default output format). */
export function buildCompactJson ({ component, classBase, extraction, relatedBlocks, meta, themeVars, propDefaults }) {
  const styles = condenseBuckets(extraction.buckets, themeVars)
  const $meta = { component, classBase, ...meta }
  if (!Object.keys(styles).length) $meta.warning = 'no CSS rules matched'

  const json = { $meta, ...styles }

  const related = Object.entries(relatedBlocks ?? {})
    .map(([base, blockExtraction]) => [base, condenseBuckets(blockExtraction.buckets, themeVars)])
    .filter(([, condensed]) => Object.keys(condensed).length)
  if (related.length) json.relatedBlocks = Object.fromEntries(related)

  const contexts = usedInContexts(extraction.buckets)
  if (contexts.length) json.usedInContexts = contexts

  if (themeVars) {
    const candidates = Object.keys(extraction.cssVariablesUsed).filter(name => themeVars.has(name)).sort()
    if (candidates.length) json.figmaVariableCandidates = candidates
  }
  json.propDefaults = propDefaults ?? null
  return json
}
