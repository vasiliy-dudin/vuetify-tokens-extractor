import fs from 'node:fs'
import postcss from 'postcss'
import { pathToFileURL } from 'node:url'
import { requireFromVuetify } from './vuetify-root.mjs'

const BLUEPRINT_NAMES = ['md1', 'md2', 'md3']

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

async function loadOptions ({ blueprintName, optionsFile }) {
  let options = {}
  let source = 'defaults'
  if (optionsFile) {
    const imported = await import(pathToFileURL(optionsFile).href)
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
