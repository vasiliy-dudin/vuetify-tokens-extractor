import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/**
 * Locates the installed `vuetify` package, starting resolution from `fromDir`
 * (normally the consumer's cwd) so it works both for npm-installed vuetify
 * and for pnpm-workspace-linked vuetify (e.g. running inside the vuetify monorepo itself).
 */
export function resolveVuetifyRoot (fromDir, override) {
  if (override) return path.resolve(override)
  try {
    const pkgJson = require.resolve('vuetify/package.json', { paths: [fromDir] })
    return path.dirname(pkgJson)
  } catch (error) {
    throw new Error(
      'Could not resolve the "vuetify" package from ' + fromDir + '. ' +
      'Install vuetify as a dependency of that project, or pass --vuetify-root <path>.\n' +
      `Original error: ${error.message}`
    )
  }
}

/** A require() scoped to the resolved vuetify package, for subpath exports like "vuetify/blueprints". */
export function requireFromVuetify (vuetifyRoot) {
  return createRequire(path.join(vuetifyRoot, 'package.json'))
}

export function readVuetifyVersion (vuetifyRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vuetifyRoot, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}
