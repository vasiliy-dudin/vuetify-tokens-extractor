import fs from 'node:fs'
import postcss from 'postcss'

const STATE_MODIFIERS = ['disabled', 'loading', 'active', 'readonly', 'selected', 'focused', 'error', 'dirty']
const STATE_PSEUDOS = ['hover', 'focus-visible', 'focus', 'active', 'disabled', 'checked', 'focus-within']

/** Parses CSS files once; returns ASTs plus the set of every class token seen. */
export function parseCssFiles (files) {
  const roots = []
  const allClassTokens = new Set()
  for (const file of files) {
    const root = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file })
    root.walkRules(rule => {
      for (const match of rule.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        allClassTokens.add(match[1])
      }
    })
    roots.push({ file, root })
  }
  return { files, roots, allClassTokens }
}

function ownsToken (token, base) {
  return token === base || token.startsWith(`${base}--`) || token.startsWith(`${base}__`)
}

// Splits one selector into compound selectors, ignoring combinators.
// Parenthesis-aware so `:not(.a .b)` stays inside its compound.
function splitCompounds (selector) {
  const compounds = []
  let current = ''
  let depth = 0
  for (const ch of selector) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (current) compounds.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) compounds.push(current)
  return compounds
}

// Class tokens of a compound, excluding those that appear only inside :not(...).
function classTokens (compound) {
  const outside = compound.replace(/:not\([^)]*\)/g, '')
  return [...outside.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(m => m[1])
}

function pseudosOf (compound) {
  const outside = compound.replace(/:not\([^)]*\)/g, '')
  return [...outside.matchAll(/::?[a-z-]+(?:\([^)]*\))?/g)]
    .map(m => m[0])
    .filter(p => !p.startsWith(':not'))
}

function attributesOf (compound) {
  const outside = compound.replace(/:not\([^)]*\)/g, '')
  return [...outside.matchAll(/\[[^\]]+\]/g)].map(m => m[0])
}

function atRuleChain (rule) {
  const chain = []
  for (let node = rule.parent; node && node.type === 'atrule'; node = node.parent) {
    if (node.name === 'media' || node.name === 'supports') {
      chain.unshift({ name: node.name, params: node.params })
    }
  }
  return chain
}

function classifySelector (selector, base, otherBases) {
  const compounds = splitCompounds(selector)
  let subjectIndex = -1
  for (let i = compounds.length - 1; i >= 0; i--) {
    if (classTokens(compounds[i]).some(t => ownsToken(t, base))) {
      subjectIndex = i
      break
    }
  }
  if (subjectIndex === -1) return null

  const modifiers = []
  const pseudos = []
  const attributes = []
  let element = null
  const context = []
  // A foreign class co-occurring in the SAME compound as the subject (e.g. `.v-checkbox.v-input`)
  // is a composition marker, not ancestry — it must not be treated like a `contextComponent`
  // (an actual ancestor selector), or condense.mjs would wrongly drop the component's own rules.
  let combinedWith = null
  let childComponent = null
  const ownedByOther = token => [...otherBases].find(b => ownsToken(token, b)) ?? null

  compounds.forEach((compound, i) => {
    const tokens = classTokens(compound)
    const own = tokens.some(t => ownsToken(t, base))
    if (i < subjectIndex && !own) {
      context.push(compound)
      return
    }
    for (const token of tokens) {
      if (!ownsToken(token, base)) {
        // after the subject, a foreign class is a descendant element this component styles
        if (i === subjectIndex) combinedWith ??= ownedByOther(token)
        else childComponent ??= ownedByOther(token)
        continue
      }
      if (token.startsWith(`${base}--`)) modifiers.push(token.slice(base.length + 2))
      else if (token.startsWith(`${base}__`) && i === subjectIndex) element = token.slice(base.length + 2)
    }
    pseudos.push(...pseudosOf(compound))
    attributes.push(...attributesOf(compound))
  })

  const contextComponent = context
    .flatMap(classTokens)
    .map(ownedByOther)
    .find(Boolean) ?? null

  return { modifiers, pseudos, attributes, element, context, contextComponent, childComponent, combinedWith }
}

function routeBucket (info, atRules) {
  const media = atRules.find(a => a.name === 'media')
  if (media?.params.includes('forced-colors')) return { bucket: 'forcedColors' }
  if (media) return { bucket: 'mediaQueries' }
  if (atRules.some(a => a.name === 'supports')) return { bucket: 'supports' }
  if (info.contextComponent) return { bucket: 'contextual' }

  for (const mod of info.modifiers) {
    const variant = mod.match(/^variant-(.+)$/)
    if (variant) return { bucket: 'variants', key: variant[1] }
  }
  for (const mod of info.modifiers) {
    const size = mod.match(/^size-(.+)$/)
    if (size) return { bucket: 'sizes', key: size[1] }
  }
  for (const mod of info.modifiers) {
    const density = mod.match(/^density-(.+)$/)
    if (density) return { bucket: 'densities', key: density[1] }
  }
  const stateModifier = STATE_MODIFIERS.find(s => info.modifiers.includes(s))
  if (stateModifier) return { bucket: 'states', key: stateModifier }
  const statePseudo = info.pseudos
    .map(p => p.replace(/^:+/, '').replace(/\(.*\)$/, ''))
    .find(p => STATE_PSEUDOS.includes(p))
  if (statePseudo) return { bucket: 'states', key: statePseudo }
  if (info.element) return { bucket: 'elements', key: info.element }
  if (info.modifiers.length) return { bucket: 'modifiers', key: info.modifiers[0] }
  return { bucket: 'base' }
}

function declarationsOf (rule) {
  return rule.nodes
    .filter(node => node.type === 'decl')
    .map(decl => {
      const entry = { prop: decl.prop, value: decl.value }
      if (decl.important) entry.important = true
      return entry
    })
}

function entryKey (selector, atRules, declarations) {
  return JSON.stringify([selector, atRules, declarations])
}

/**
 * Collects and classifies every rule belonging to `base` across parsed CSS roots.
 * Returns { buckets, cssVariablesUsed }.
 */
export function extractComponent (parsed, base, allComponentBases) {
  const otherBases = new Set([...allComponentBases].filter(b => b !== base))
  const buckets = {
    base: [],
    variants: {},
    sizes: {},
    densities: {},
    modifiers: {},
    states: {},
    elements: {},
    contextual: [],
    mediaQueries: [],
    forcedColors: [],
    supports: [],
  }
  const cssVariablesUsed = {}
  const seen = new Set()

  for (const { root } of parsed.roots) {
    root.walkRules(rule => {
      if (rule.parent?.type === 'atrule' && rule.parent.name.includes('keyframes')) return
      const atRules = atRuleChain(rule)

      for (const selector of rule.selectors) {
        const info = classifySelector(selector, base, otherBases)
        if (!info) continue
        const declarations = declarationsOf(rule)
        if (!declarations.length) continue

        const key = entryKey(selector, atRules, declarations)
        if (seen.has(key)) continue
        seen.add(key)

        const entry = { selector, declarations }
        const conditions = {}
        if (info.modifiers.length) conditions.modifiers = info.modifiers
        if (info.pseudos.length) conditions.pseudos = info.pseudos
        if (info.attributes.length) conditions.attributes = info.attributes
        if (info.element) conditions.element = info.element
        if (info.context.length) conditions.context = info.context.join(' ')
        if (info.contextComponent) conditions.contextComponent = info.contextComponent
        if (info.childComponent) conditions.childComponent = info.childComponent
        if (info.combinedWith) conditions.combinedWith = info.combinedWith
        if (Object.keys(conditions).length) entry.conditions = conditions
        if (atRules.length) entry.atRules = atRules

        for (const decl of declarations) {
          for (const m of decl.value.matchAll(/var\((--v-[\w-]+)/g)) {
            cssVariablesUsed[m[1]] = (cssVariablesUsed[m[1]] ?? 0) + 1
          }
        }

        const route = routeBucket(info, atRules)
        const target = buckets[route.bucket]
        if (Array.isArray(target)) target.push(entry)
        else (target[route.key] ??= []).push(entry)
      }
    })
  }

  return { buckets, cssVariablesUsed }
}

/**
 * Finds sub-block class bases derived from `base` (e.g. v-data-table-column)
 * that are not themselves registered components.
 */
export function findRelatedBases (parsed, base, allComponentBases) {
  const related = new Set()
  for (const token of parsed.allClassTokens) {
    if (!token.startsWith(`${base}-`) || ownsToken(token, base)) continue
    const blockBase = token.split('--')[0].split('__')[0]
    if (blockBase === base || allComponentBases.has(blockBase)) continue
    // skip when the token belongs to a longer registered component (v-btn-group__divider)
    const ownedByOther = [...allComponentBases].some(b => b !== base && ownsToken(token, b))
    if (!ownedByOther) related.add(blockBase)
  }
  return [...related].sort()
}
