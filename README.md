# vuetify-tokens-extractor

Extracts Vuetify component styles (padding, radius, fonts, colours, sizes, states) into JSON — one file per component. The data source is compiled CSS, so custom SASS variables and blueprints are picked up automatically.

## Requirements

Run this from inside (or against) a project that has `vuetify` installed and built — the tool resolves the `vuetify` package via Node module resolution, the same way `import 'vuetify'` would from that project. `vuetify` is a `peerDependency` (`>=3.0.0`) of this package, not a bundled dependency: it always uses *your* installed version, never one it brings itself.

This package is not published to the npm registry — it's only available on GitHub, and only tested with pnpm.

## Quick start

Add it as a devDependency:

```bash
pnpm add -D github:vasiliy-dudin/vuetify-tokens-extractor
```

In a Vuetify monorepo checkout, build the `vuetify` package first:

```bash
pnpm build docs
```
or
```bash
pnpm --filter vuetify build
```

Then run it from the project whose Vuetify build you want to inspect (`cwd` is where `vuetify` gets resolved from):

```bash
pnpm exec vuetify-tokens-extractor VBtn VChip
pnpm exec vuetify-tokens-extractor --all
```

The theme is read from your app's own `createVuetify()` call — that file stays the single source of truth. With no flags the tool looks for a conventional source in the cwd and prints the one it picked; in a Vuetify monorepo that is `packages/docs/src/plugins/vuetify.ts`:

```bash
theme source auto-detected: packages/docs/src/plugins/vuetify.ts
```

Pass `--vuetify-options` to name it yourself, whether that is the app file or a config of your own:

```bash
pnpm exec vuetify-tokens-extractor --all --vuetify-options packages/docs/src/plugins/vuetify.ts
pnpm exec vuetify-tokens-extractor --all --vuetify-options vuetify-tokens.config.ts
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
| `--vuetify-options <file>` | theme source: your app's own `createVuetify()` file, or a plain data module default-exporting `createVuetify` options. Overrides auto-detection. TypeScript is loaded via jiti |
| `--theme-css <file>` | pre-built theme CSS instead of generating it in Node |
| `--no-theme` | skip theming: `var` values stay unresolved, `propDefaults: null` |
| `--full` | detailed format instead of compact |

When no theme source is given and none is auto-detected, theme values come from Vuetify's own defaults (no blueprint, default light/dark themes). The tool then prints a warning to stderr and records `$meta.themeWarning` in every file it writes, because those values do not reflect your project's own `createVuetify()` config.

## Where the theme data comes from

Theme colours and interaction-state opacities (`--v-theme-*`, `--v-hover-opacity`, ...) aren't in the compiled CSS — Vuetify generates them at runtime from `createVuetify()` options. This tool reproduces that headlessly in Node, with no browser and no dev server.

### Two shapes of theme source

`--vuetify-options` accepts either, and the tool tells them apart by what the module exports:

**Your app's own Vuetify file** — the one that calls `createVuetify()`. Nothing to keep in sync, because it *is* the app's configuration. The tool imports it with stylesheet imports replaced by empty modules and extensionless relative imports resolved, calls its exported install function with a stand-in Vue app, and takes the Vuetify instance that function installs.

```ts
// packages/docs/src/plugins/vuetify.ts — untouched application code
export function installVuetify (app: App) {
  const vuetify = createVuetify({ blueprint: md3, theme: { themes: { light: { colors: { primary: '#3545E1' } } } } })
  app.use(vuetify)
}
```

**A plain data module** default-exporting `createVuetify` options. Use it when the app file can't be loaded, or when the extracted theme should deliberately differ from the app's:

```ts
// vuetify-tokens.config.ts
export default {
  blueprint: 'md3',
  theme: { themes: { light: { colors: { primary: '#3545E1' } } } },
}
```

`blueprint` is a plain string here (`md1` / `md2` / `md3`) — the tool resolves it from the same Vuetify install the CSS came from, so the config needs no `vuetify/blueprints` import.

### What gets detected when you pass nothing

With no `--vuetify-options`, `--blueprint`, `--theme-css` or `--no-theme`, the first of these that exists in the cwd is used, and the choice is printed to stderr:

1. `vuetify-tokens.config.ts` / `.mts` / `.mjs` / `.js`
2. `packages/docs/src/plugins/vuetify.ts`
3. `src/plugins/vuetify.ts`

A dedicated config file therefore overrides the app file without touching application code. If none exists, the theme falls back to Vuetify's built-in defaults and the tool says so.

### Requirements and limits for app files

- Loading an app file needs **Node 22.15 or newer** (it uses `node:module` `registerHooks` to stub stylesheets). Plain data modules have no such floor. The error message says which case you hit.
- The app file is **executed**, so it must be free of side effects beyond building Vuetify. Auto-imported globals (`h`, `camelize`) are fine as long as they are only used inside functions, not at module top level.
- The module must either export exactly one function that installs Vuetify onto the app it is given, or export the created instance directly.
- Theme changes made at runtime, after `createVuetify()`, are invisible here — see the limitations note in `CLAUDE.md`.

### Other ways in

- `--blueprint <name>` — Vuetify defaults plus a blueprint, ignoring any project config.
- `--theme-css <file>` — a stylesheet you already captured (e.g. the contents of a running app's `<style id="vuetify-theme-stylesheet">` tag), which skips Node generation entirely.
- `--no-theme` — no theme at all: `var()` references stay unresolved.

## Using it against a monorepo-style Vuetify checkout

If `vuetify` isn't an installed dependency in the usual `node_modules` sense (e.g. you're running this against the Vuetify repository itself), point at it explicitly:

```bash
pnpm exec vuetify-tokens-extractor VBtn --vuetify-root path/to/packages/vuetify
```

## Upgrading

The dependency tracks the default branch, so upgrading is a reinstall:

```bash
pnpm install
```

## How it works

1. `src/vuetify-root.mjs` — resolves the `vuetify` package location from the given `cwd` (or `--vuetify-root`).
2. `src/components.mjs` — the component list and their CSS classes come from `<vuetify>/dist/json/importMap.json`.
3. `src/parser.mjs` — CSS is parsed with postcss; rules are sorted into variants/sizes/states based on exact class-token matching (`v-btn` is never confused with `v-btn-group`).
4. `src/app-loader.mjs` — makes app source importable in Node (stylesheet imports stubbed, extensionless imports resolved) and pulls the Vuetify instance out of it.
5. `src/theme.mjs` — the theme and prop defaults come from that instance, or from calling `createVuetify(...)` on a plain options module. No browser required.
6. `src/condense.mjs` / `src/serialize.mjs` — assembles the final JSON (compact or full), substituting theme values.
