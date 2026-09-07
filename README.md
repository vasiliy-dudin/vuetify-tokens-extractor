# vuetify-tokens-extractor

Extracts Vuetify component styles (padding, radius, fonts, colours, sizes, states) into JSON — one file per component. The data source is compiled CSS, so custom SASS variables and blueprints are picked up automatically.

## Requirements

Run this from inside (or against) a project that has `vuetify` installed and built — the tool resolves the `vuetify` package via Node module resolution, the same way `import 'vuetify'` would from that project. `vuetify` is a `peerDependency` (`>=3.0.0`) of this package, not a bundled dependency: it always uses *your* installed version, never one it brings itself.

**Build the `vuetify` package itself before running this tool — not your app.** The tool reads `<vuetify>/dist/vuetify.css` (and `dist/vuetify-labs.css`), which only exist after `vuetify`'s own build step has run. Building the app that *consumes* Vuetify does not refresh them: `vite build`, or `pnpm build docs` in the Vuetify monorepo, rebuilds the app and leaves `packages/vuetify/dist/` untouched. Without the right build the CSS is missing or stale, and extraction fails or produces incomplete output.

| Where you're running it | What to build first |
|---|---|
| a Vuetify monorepo checkout | `pnpm --filter vuetify build` (equivalently `pnpm build dev`) |
| a project using `vuetify` from npm | nothing — the published package ships a prebuilt `dist/` |

This package is not published to the npm registry — it's only available on GitHub, and only tested with pnpm.

## Quick start

Add it as a devDependency, pinned to a tag:

```bash
pnpm add -D github:vasiliy-dudin/vuetify-tokens-extractor#v0.2.0
```

Then run it from the project whose Vuetify build you want to inspect (`cwd` is where `vuetify` gets resolved from):

```bash
pnpm exec vuetify-tokens-extractor VBtn VChip
pnpm exec vuetify-tokens-extractor --all
```

Output is written to `style-tokens/` in that directory — one JSON per component, plus `_theme.json` with theme colours and variables.

## Output format

The default format is compact: flat keys such as `variant:elevated`, `size:default`, `state:hover element:overlay`, containing only design-relevant CSS properties.

```json
"variant:elevated": {
  "background": { "value": "rgb(255,251,254)", "var": "rgb(var(--v-theme-surface))" }
},
"size:default": { "height": "36px", "padding": "0 16px" }
```

`value` is the resolved value for the default theme; `var` is the original CSS variable (a candidate Figma Variable).

Extra fields in each file:
- `figmaVariableCandidates` — theme variables the component uses
- `usedInContexts` — other components that override this one's styles
- `propDefaults` — resolved prop defaults (global + component-specific, including blueprint defaults)

`--full` returns the detailed format: each CSS rule as its own entry with its selector and conditions (`base`/`variants`/`sizes`/`states`/`elements`/...). Use it to debug the tool itself or when every detail is needed without loss.

## Options

| Flag | Purpose |
|---|---|
| `--all` | all components instead of an explicit list |
| `--css <path>` | custom CSS instead of `<vuetify>/dist/vuetify.css` (repeatable) |
| `--out <dir>` | output folder (defaults to `style-tokens/` in the cwd) |
| `--vuetify-root <path>` | use this vuetify install instead of resolving one from the cwd |
| `--blueprint md1\|md2\|md3` | apply a blueprint when generating the theme |
| `--vuetify-options <file>` | file with a default export of `createVuetify` options (theme, blueprint, defaults); `.mjs` / `.js` / `.ts` / `.mts` / `.cts`, TypeScript loaded via jiti |
| `--theme-css <file>` | pre-built theme CSS instead of generating it in Node |
| `--no-theme` | skip theming: `var` values stay unresolved, `propDefaults: null` |
| `--full` | detailed format instead of compact |

Without `--vuetify-options` or `--blueprint`, theme values come from Vuetify's own defaults (no blueprint, default light/dark themes). The tool then prints a warning to stderr and records `$meta.themeWarning` in every file it writes, because those values do not reflect your project's own `createVuetify()` config.

## Where the theme data comes from

Theme colours and interaction-state opacities (`--v-theme-*`, `--v-hover-opacity`, ...) aren't in the compiled CSS — Vuetify generates them at runtime from `createVuetify()` options. This tool reproduces that headlessly in Node (no browser) by importing the resolved `vuetify` package and calling `createVuetify()` with:

- nothing (defaults), or
- `--blueprint <name>`, or
- `--vuetify-options <file>` — a file that default-exports the same options object your app passes to `createVuetify()` (theme, blueprint, defaults), or
- `--theme-css <file>` — a stylesheet you already captured (e.g. the contents of a running app's `<style id="vuetify-theme-stylesheet">` tag), which skips Node generation entirely.

### Your app's Vuetify plugin file usually can't be passed directly

`--vuetify-options` is imported in plain Node, and a typical `plugins/vuetify.ts` cannot be: it imports `vuetify/styles` and `vuetify/components/*` (CSS, which Node has no loader for), often pulls in other packages that do the same, may rely on bundler auto-imports (`h`, `camelize`), and frequently exports an install function rather than the options object.

Extract the theme into a standalone data module, and point both your app and this tool at it:

```ts
// src/plugins/theme.ts — no imports, no side effects
export const theme = {
  themes: {
    light: { colors: { primary: '#3545E1' } },
  },
}
```

```ts
// src/plugins/vuetify.ts
import { theme } from './theme'

createVuetify({ blueprint: md3, theme /* ... */ })
```

```ts
// vuetify-tokens.config.ts, next to package.json
import { theme } from './src/plugins/theme'

export default { blueprint: 'md3', theme }
```

```bash
pnpm exec vuetify-tokens-extractor VBtn --vuetify-options vuetify-tokens.config.ts
```

`blueprint` is a plain string here (`md1` / `md2` / `md3`) — the tool resolves it from the same Vuetify install the CSS came from, so the config needs no `vuetify/blueprints` import.

## Using it against a monorepo-style Vuetify checkout

If `vuetify` isn't an installed dependency in the usual `node_modules` sense (e.g. you're running this against the Vuetify repository itself), point at it explicitly:

```bash
pnpm exec vuetify-tokens-extractor VBtn --vuetify-root path/to/packages/vuetify
```

## Upgrading

Pinning to a tag (as in [Quick start](#quick-start)) means upgrading is a version bump, not a manual copy: edit the `#v0.2.0` ref in `package.json` to the new tag, then reinstall:

```bash
pnpm install
```

## How it works

1. `src/vuetify-root.mjs` — resolves the `vuetify` package location from the given `cwd` (or `--vuetify-root`).
2. `src/components.mjs` — the component list and their CSS classes come from `<vuetify>/dist/json/importMap.json`.
3. `src/parser.mjs` — CSS is parsed with postcss; rules are sorted into variants/sizes/states based on exact class-token matching (`v-btn` is never confused with `v-btn-group`).
4. `src/theme.mjs` — the theme and prop defaults are generated in Node by calling `createVuetify(...)`, no browser required.
5. `src/condense.mjs` / `src/serialize.mjs` — assembles the final JSON (compact or full), substituting theme values.
