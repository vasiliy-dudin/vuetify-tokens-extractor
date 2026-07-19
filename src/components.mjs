import fs from 'node:fs'
import path from 'node:path'

// Components whose root CSS class is not the kebab-case of their name.
const CLASS_BASE_OVERRIDES = {
  VApp: 'v-application',
}

/** Converts a PascalCase component name to its CSS class base (VBtn -> v-btn). */
export function kebab (name) {
  return CLASS_BASE_OVERRIDES[name] ?? name.replace(/[A-Z]/g, (m, i) => (i === 0 ? '' : '-') + m.toLowerCase())
}

function readImportMap (file) {
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8')).components ?? {}
}

/**
 * Loads the component index from the vuetify package's importMap files.
 * Returns Map<Name, { labs: boolean, classBase: string }>.
 */
export function loadComponentIndex (vuetifyRoot) {
  const jsonDir = path.join(vuetifyRoot, 'dist', 'json')
  const stable = readImportMap(path.join(jsonDir, 'importMap.json'))
  const labs = readImportMap(path.join(jsonDir, 'importMap-labs.json'))

  const index = new Map()
  for (const name of Object.keys(stable)) {
    index.set(name, { labs: false, classBase: kebab(name) })
  }
  for (const name of Object.keys(labs)) {
    if (!index.has(name)) index.set(name, { labs: true, classBase: kebab(name) })
  }
  if (index.size === 0) {
    throw new Error(
      `No importMap.json found under ${jsonDir}. ` +
      'Build vuetify first (e.g. "pnpm build" in the vuetify package) or point --vuetify-root at a built install.'
    )
  }
  return index
}

/** Validates requested names against the index; throws with near matches on failure. */
export function resolveComponents (index, names) {
  const unknown = names.filter(name => !index.has(name))
  if (unknown.length) {
    const known = [...index.keys()]
    const hints = unknown.map(name => {
      const lower = name.toLowerCase()
      const near = known.filter(k => k.toLowerCase().includes(lower.replace(/^v/, ''))).slice(0, 5)
      return `  ${name}${near.length ? ` — did you mean: ${near.join(', ')}?` : ''}`
    })
    throw new Error(`Unknown component(s):\n${hints.join('\n')}`)
  }
  return names.map(name => ({ name, ...index.get(name) }))
}
