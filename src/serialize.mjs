import fs from 'node:fs'
import path from 'node:path'

const MAX_VAR_RESOLUTION_PASSES = 5

/** Substitutes var(--v-*) references using the theme variable map; returns null when nothing changed. */
export function resolveVars (value, themeVars) {
  if (!themeVars || !value.includes('var(--v-')) return null
  let resolved = value
  for (let pass = 0; pass < MAX_VAR_RESOLUTION_PASSES; pass++) {
    const next = resolved.replace(
      /var\(\s*(--v-[\w-]+)\s*(?:,\s*([^()]+|[^()]*\([^()]*\)[^()]*))?\)/g,
      (match, name, fallback) => themeVars.get(name) ?? (fallback !== undefined ? fallback.trim() : match)
    )
    if (next === resolved) break
    resolved = next
  }
  return resolved === value ? null : resolved
}

function withResolvedVars (entries, themeVars) {
  return entries.map(entry => ({
    ...entry,
    declarations: entry.declarations.map(decl => {
      const resolved = resolveVars(decl.value, themeVars)
      return resolved ? { ...decl, resolved } : decl
    }),
  }))
}

function resolveBucketVars (buckets, themeVars) {
  const out = {}
  for (const [name, bucket] of Object.entries(buckets)) {
    if (Array.isArray(bucket)) {
      out[name] = withResolvedVars(bucket, themeVars)
    } else {
      out[name] = Object.fromEntries(
        Object.entries(bucket).map(([key, entries]) => [key, withResolvedVars(entries, themeVars)])
      )
    }
  }
  return out
}

/** Assembles the final per-component JSON object. */
export function buildComponentJson ({ component, classBase, extraction, relatedBlocks, meta, themeVars, propDefaults }) {
  const empty = !Object.values(extraction.buckets).some(
    bucket => Array.isArray(bucket) ? bucket.length : Object.keys(bucket).length
  )
  const $meta = {
    component,
    classBase,
    generatedAt: new Date().toISOString(),
    ...meta,
  }
  if (empty) $meta.warning = 'no CSS rules matched'

  const json = {
    $meta,
    ...resolveBucketVars(extraction.buckets, themeVars),
  }
  if (relatedBlocks && Object.keys(relatedBlocks).length) {
    json.relatedBlocks = Object.fromEntries(
      Object.entries(relatedBlocks).map(([blockBase, blockExtraction]) => [
        blockBase,
        resolveBucketVars(blockExtraction.buckets, themeVars),
      ])
    )
  }
  json.cssVariablesUsed = extraction.cssVariablesUsed
  json.propDefaults = propDefaults ?? null
  return json
}

export function writeJson (outDir, fileName, data) {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, fileName)
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return file
}
