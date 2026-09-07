import * as nodeModule from 'node:module'

const STYLE_RE = /\.(css|sass|scss|less|styl)(\?|$)/
const EMPTY_MODULE_URL = 'data:text/javascript,export default {}'
const IMPLICIT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.js']

let hooksRegistered = false

/** Whether this Node build can stub the stylesheet imports every app plugin file has. */
export function canLoadAppFiles () {
  return typeof nodeModule.registerHooks === 'function'
}

function resolveWithExtensions (specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context)
  } catch (error) {
    // TypeScript sources omit the extension on relative imports; Node's ESM resolver requires it.
    if (!specifier.startsWith('.')) throw error
    for (const extension of IMPLICIT_EXTENSIONS) {
      try {
        return nextResolve(specifier + extension, context)
      } catch {}
    }
    throw error
  }
}

/**
 * Makes app source loadable outside a bundler: stylesheet imports become empty modules,
 * extensionless relative imports get their extension back. Registering twice is a no-op.
 */
export function registerAppHooks () {
  if (hooksRegistered || !canLoadAppFiles()) return
  hooksRegistered = true
  nodeModule.registerHooks({
    resolve (specifier, context, nextResolve) {
      const resolved = resolveWithExtensions(specifier, context, nextResolve)
      if (STYLE_RE.test(resolved.url)) return { url: EMPTY_MODULE_URL, shortCircuit: true }
      return resolved
    },
  })
}

// Enough of the createVuetify() option surface to tell a config object from a module namespace.
const VUETIFY_OPTION_KEYS = [
  'theme', 'blueprint', 'defaults', 'components', 'directives',
  'icons', 'locale', 'date', 'display', 'aliases', 'ssr',
]

/** A live Vuetify instance, as returned by createVuetify(). */
function isVuetifyInstance (value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof value.install === 'function' &&
    Boolean(value.theme?.styles)
}

/** A plain createVuetify() options object, as a config module default-exports. */
function isOptionsObject (value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    !isVuetifyInstance(value) &&
    VUETIFY_OPTION_KEYS.some(key => key in value)
}

/** Minimal Vue App stand-in: enough for a plugin installer to run and hand over the instance. */
function createStubApp (onUse) {
  const app = {
    use (plugin) {
      onUse(plugin)
      return app
    },
    component: () => app,
    directive: () => app,
    provide: () => app,
    mixin: () => app,
    mount: () => app,
    unmount: () => undefined,
    config: { globalProperties: {} },
  }
  return app
}

/**
 * Pulls a live Vuetify instance out of an app module — exported directly, or installed onto a
 * Vue app by the module's single exported function. Returns null for a plain options module.
 */
export function extractVuetifyInstance (imported) {
  const exported = Object.values(imported)

  const direct = exported.find(isVuetifyInstance)
  if (direct) return direct

  // Key-based, not just "is an object": jiti gives every module a `default`, even one that
  // only has named exports, so shape is the only way to tell options from a namespace.
  if (isOptionsObject(imported.default)) return null

  const installers = exported.filter(value => typeof value === 'function')
  if (installers.length !== 1) return null

  let captured = null
  installers[0](createStubApp(plugin => { captured = plugin }))
  return isVuetifyInstance(captured) ? captured : null
}
