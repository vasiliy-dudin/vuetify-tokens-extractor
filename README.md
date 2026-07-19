# vuetify-tokens-extractor

Extracts Vuetify component styles (padding, radius, fonts, colours, sizes, states) into JSON — one file per component. The data source is compiled CSS, so custom SASS variables and blueprints are picked up automatically.

## Requirements

Run this from inside (or against) a project that has `vuetify` installed and built — the tool resolves the `vuetify` package via Node module resolution, the same way `import 'vuetify'` would from that project.

## Quick start

```bash
npx vuetify-tokens-extractor VBtn VChip
npx vuetify-tokens-extractor --all
```

Run it from the project whose Vuetify build you want to inspect (`cwd` is where `vuetify` gets resolved from). Output is written to `style-tokens/` in that directory — one JSON per component, plus `_theme.json` with theme colours and variables.

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
| `--vuetify-options <file>` | file with a default export of `createVuetify` options (theme, blueprint, defaults) |
| `--theme-css <file>` | pre-built theme CSS instead of generating it in Node |
| `--no-theme` | skip theming: `var` values stay unresolved, `propDefaults: null` |
| `--full` | detailed format instead of compact |

Without `--vuetify-options` or `--blueprint`, theme values come from Vuetify's own defaults (no blueprint, default light/dark themes).

## Where the theme data comes from

Theme colours and interaction-state opacities (`--v-theme-*`, `--v-hover-opacity`, ...) aren't in the compiled CSS — Vuetify generates them at runtime from `createVuetify()` options. This tool reproduces that headlessly in Node (no browser) by importing the resolved `vuetify` package and calling `createVuetify()` with:

- nothing (defaults), or
- `--blueprint <name>`, or
- `--vuetify-options <file>` — a file that default-exports the same options object your app passes to `createVuetify()` (theme, blueprint, defaults), or
- `--theme-css <file>` — a stylesheet you already captured (e.g. the contents of a running app's `<style id="vuetify-theme-stylesheet">` tag), which skips Node generation entirely.

## Using it against a monorepo-style Vuetify checkout

If `vuetify` isn't an installed dependency in the usual `node_modules` sense (e.g. you're running this against the Vuetify repository itself), point at it explicitly:

```bash
npx vuetify-tokens-extractor VBtn --vuetify-root path/to/packages/vuetify
```

## Consuming this package as a pinned dependency

Add it as a git dependency pinned to a tag, so upgrading is a version bump rather than a manual copy:

```json
{
  "devDependencies": {
    "vuetify-tokens-extractor": "github:<you>/vuetify-tokens-extractor#v0.1.0"
  }
}
```

```bash
pnpm install
pnpm exec vuetify-tokens-extractor VBtn --vuetify-options ./vuetify-tokens.config.mjs
```

Bumping to a new release is then just editing the tag in `package.json` and reinstalling.

## How it works

1. `src/vuetify-root.mjs` — resolves the `vuetify` package location from the given `cwd` (or `--vuetify-root`).
2. `src/components.mjs` — the component list and their CSS classes come from `<vuetify>/dist/json/importMap.json`.
3. `src/parser.mjs` — CSS is parsed with postcss; rules are sorted into variants/sizes/states based on exact class-token matching (`v-btn` is never confused with `v-btn-group`).
4. `src/theme.mjs` — the theme and prop defaults are generated in Node by calling `createVuetify(...)`, no browser required.
5. `src/condense.mjs` / `src/serialize.mjs` — assembles the final JSON (compact or full), substituting theme values.
