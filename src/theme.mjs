import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { pathToFileURL } from 'node:url'
import { requireFromVuetify } from './vuetify-root.mjs'

const BLUEPRINT_NAMES = ['md1', 'md2', 'md3']

/** `themeData.source` value meaning no theme input was given, so Vuetify's own defaults were used. */
export const DEFAULT_THEME_SOURCE = 'defaults'

/** Recorded in `$meta.themeWarning` so the JSON explains itself without access to the CLI's stderr. */
export const THEME_DEFAULTS_NOTE =
  'Theme values are Vuetify built-in defaults; they do not reflect the createVuetify() options of this project.'

/** Parses a theme stylesheet into Map<themeName, Map<'--v-*', value>>. */
export function parseThemeCss (cssText) {
  const themes = new Map()
  const root = postcss.parse(cssText)
  root.walkRules(rule => {
    for (const selector of rule.selectors) {
      const match = selector.match(/^\.v-theme--([\w-]+)$/) ?? (selector === ':root' ? [null, ':root'] : null)
      if (!match) continue
      const vars = themes.get(match[1]) ?? new Map()
      rule.walkDecls(/^--v-/, decl => vars.set(decl.prop, decl.value))
      if (vars.size) themes.set(match[1], vars)
    }
  })
  return themes
}

async function importVuetify (vuetifyRoot) {
  const require = requireFromVuetify(vuetifyRoot)
  try {
    const vuetify = await import(pathToFileURL(require.resolve('vuetify')).href)
    const blueprints = await import(pathToFileURL(require.resolve('vuetify/blueprints')).href)
    return { vuetify, blueprints }
  } catch (error) {
    throw new Error(
      `Cannot import vuetify from ${vuetifyRoot} (is it built? e.g. "pnpm build" in that package), ` +
      'or pass --theme-css / --no-theme.\n' + `Original error: ${error.message}`
    )
  }
}

const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

const OPTIONS_FILE_HINT =
  'The options file must be plain data with no framework imports. Importing "vuetify/styles", ' +
  '"vuetify/components/*" or "@vuetify/one", or relying on bundler auto-imports such as h() or camelize(), ' +
  'cannot work here: Node has no Vite transform and no CSS loader. ' +
  'Extract just the theme into a standalone data module and point this file at that.'

/** Imports a createVuetify options file. TypeScript goes through jiti, everything else through Node. */
async function importOptionsFile (optionsFile) {
  const href = pathToFileURL(optionsFile).href
  if (!TS_EXTENSIONS.has(path.extname(optionsFile).toLowerCase())) {
    return await import(href)
  }

  let createJiti
  try {
    ({ createJiti } = await import('jiti'))
  } catch (error) {
    throw new Error(
      `Cannot load the TypeScript options file ${optionsFile}: the "jiti" dependency is missing. ` +
      'Reinstall the dependencies of this package, or pass a .mjs options file instead.\n' +
      `Original error: ${error.message}`
    )
  }

  try {
    return await createJiti(import.meta.url).import(href)
  } catch (error) {
    throw new Error(
      `Cannot load the options file ${optionsFile}.\n` + OPTIONS_FILE_HINT + '\n' +
      `Original error: ${error.message}`
    )
  }
}

async function loadOptions ({ blueprintName, optionsFile }) {
  let options = {}
  let source = DEFAULT_THEME_SOURCE
  if (optionsFile) {
    const imported = await importOptionsFile(optionsFile)
    options = imported.default ?? imported
    source = `options:${optionsFile}`
  }
  if (blueprintName) {
    options = { ...options, blueprint: blueprintName }
    if (!optionsFile) source = `blueprint:${blueprintName}`
  }
  return { options, source }
}

/**
 * Builds theme data headlessly via createVuetify.
 * Returns { source, blueprint, themes, themeVarsByName, defaults, defaultThemeName }.
 */
export async function generateTheme ({ vuetifyRoot, blueprintName, optionsFile, themeCssFile }) {
  if (themeCssFile) {
    const themeVarsByName = parseThemeCss(fs.readFileSync(themeCssFile, 'utf8'))
    return {
      source: `file:${themeCssFile}`,
      blueprint: null,
      themes: null,
      themeVarsByName,
      defaults: null,
      defaultThemeName: [...themeVarsByName.keys()].find(n => n !== ':root') ?? 'light',
    }
  }

  const { vuetify, blueprints } = await importVuetify(vuetifyRoot)
  const { options, source } = await loadOptions({ blueprintName, optionsFile })

  let blueprint = options.blueprint ?? null
  if (typeof blueprint === 'string') {
    if (!BLUEPRINT_NAMES.includes(blueprint)) {
      throw new Error(`Unknown blueprint "${blueprint}". Expected one of: ${BLUEPRINT_NAMES.join(', ')}`)
    }
    blueprint = blueprints[blueprint]
  }
  const blueprintLabel = typeof options.blueprint === 'string' ? options.blueprint : (blueprint ? 'custom' : null)

  const app = vuetify.createVuetify({ ...options, blueprint: blueprint ?? undefined })
  const themeVarsByName = parseThemeCss(app.theme.styles.value)

  return {
    source,
    blueprint: blueprintLabel,
    themes: app.theme.computedThemes.value,
    themeVarsByName,
    defaults: app.defaults.value,
    defaultThemeName: typeof options.theme?.defaultTheme === 'string' ? options.theme.defaultTheme : 'light',
  }
}

/** Extra stderr lines for the defaults fallback: the primary colour used, and how to fix it. */
export function defaultsWarningDetails (themeData) {
  const primary = themeData.themes?.[themeData.defaultThemeName]?.colors?.primary
  return [
    ...(primary ? [`  Resolved "${themeData.defaultThemeName}" primary: ${primary}`] : []),
    '  Fix: --vuetify-options <file> | --blueprint md1|md2|md3 | --theme-css <file>',
    '  Silence: --no-theme (leaves var() references unresolved)',
  ]
}

/** Resolved prop defaults for one component: global defaults merged with component-specific ones. */
export function componentDefaults (defaults, componentName) {
  if (!defaults) return null
  const merged = { ...defaults.global, ...defaults[componentName] }
  // nested keys like VProgressCircular inside VBtn defaults are kept as-is
  return Object.keys(merged).length ? merged : null
}

/** Builds the shared _theme.json payload. */
export function buildThemeJson (themeData, meta) {
  return {
    $meta: { generatedAt: new Date().toISOString(), themeSource: themeData.source, ...meta },
    blueprint: themeData.blueprint,
    defaultTheme: themeData.defaultThemeName,
    themes: themeData.themes,
    cssVariables: Object.fromEntries(
      [...themeData.themeVarsByName].map(([name, vars]) => [name, Object.fromEntries(vars)])
    ),
    globalDefaults: themeData.defaults?.global ?? null,
  }
}
