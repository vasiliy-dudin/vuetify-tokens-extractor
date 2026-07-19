import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadComponentIndex, resolveComponents } from './components.mjs'
import { buildCompactJson } from './condense.mjs'
import { extractComponent, findRelatedBases, parseCssFiles } from './parser.mjs'
import { buildComponentJson, writeJson } from './serialize.mjs'
import { buildThemeJson, componentDefaults, generateTheme } from './theme.mjs'
import { readVuetifyVersion, resolveVuetifyRoot } from './vuetify-root.mjs'

function parseCliArgs (argv, cwd) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      css: { type: 'string', multiple: true },
      out: { type: 'string', default: path.join(cwd, 'style-tokens') },
      'vuetify-root': { type: 'string' },
      blueprint: { type: 'string' },
      'vuetify-options': { type: 'string' },
      'theme-css': { type: 'string' },
      'no-theme': { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
    },
  })
  if (!values.all && positionals.length === 0) {
    throw new Error('Pass component names (e.g. VBtn VChip) or --all. See README.md.')
  }
  return { values, positionals }
}

function defaultCssFiles (vuetifyRoot, components) {
  const files = [path.join(vuetifyRoot, 'dist', 'vuetify.css')]
  if (components.some(c => c.labs)) {
    files.push(path.join(vuetifyRoot, 'dist', 'vuetify-labs.css'))
  }
  return files
}

export async function run (argv, { cwd = process.cwd() } = {}) {
  const { values, positionals } = parseCliArgs(argv, cwd)

  const vuetifyRoot = resolveVuetifyRoot(cwd, values['vuetify-root'])
  const index = loadComponentIndex(vuetifyRoot)
  const components = values.all
    ? [...index].map(([name, info]) => ({ name, ...info }))
    : resolveComponents(index, positionals)

  const cssFiles = (values.css?.length ? values.css : defaultCssFiles(vuetifyRoot, components))
    .map(f => path.resolve(cwd, f))
  for (const file of cssFiles) {
    if (!fs.existsSync(file)) throw new Error(`CSS file not found: ${file}`)
  }
  const parsed = parseCssFiles(cssFiles)
  const allBases = new Set([...index.values()].map(info => info.classBase))

  let themeData = null
  if (!values['no-theme']) {
    themeData = await generateTheme({
      vuetifyRoot,
      blueprintName: values.blueprint,
      optionsFile: values['vuetify-options'] && path.resolve(cwd, values['vuetify-options']),
      themeCssFile: values['theme-css'] && path.resolve(cwd, values['theme-css']),
    })
  }
  const themeVars = themeData
    ? new Map([
      ...(themeData.themeVarsByName.get(':root') ?? []),
      ...(themeData.themeVarsByName.get(themeData.defaultThemeName) ?? []),
    ])
    : null

  const meta = {
    vuetifyVersion: readVuetifyVersion(vuetifyRoot),
    cssSources: cssFiles.map(f => path.relative(cwd, f) || f),
    themeSource: themeData?.source ?? 'none',
    blueprint: themeData?.blueprint ?? null,
  }
  if (themeData) meta.defaultTheme = themeData.defaultThemeName

  const written = []
  const warnings = []
  for (const { name, classBase } of components) {
    const extraction = extractComponent(parsed, classBase, allBases)
    const relatedBlocks = {}
    for (const relatedBase of findRelatedBases(parsed, classBase, allBases)) {
      relatedBlocks[relatedBase] = extractComponent(parsed, relatedBase, allBases)
    }
    const buildJson = values.full ? buildComponentJson : buildCompactJson
    const json = buildJson({
      component: name,
      classBase,
      extraction,
      relatedBlocks,
      meta,
      themeVars,
      propDefaults: componentDefaults(themeData?.defaults, name),
    })
    if (json.$meta.warning) {
      warnings.push(`${name}: ${json.$meta.warning}`)
      continue
    }
    written.push(writeJson(values.out, `${name}.json`, json))
  }

  if (themeData) {
    written.push(writeJson(values.out, '_theme.json', buildThemeJson(themeData, { vuetifyVersion: meta.vuetifyVersion })))
  }

  for (const warning of warnings) console.error(`warning: ${warning}`)
  console.log(`Wrote ${written.length} file(s) to ${path.relative(cwd, values.out) || values.out}`)
}
