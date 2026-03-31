# OpenTUI + Solid dependency and TS interop notes

## Dependency additions
Added runtime dependencies in `package.json` and root lock manifest (`package-lock.json`):

- `@opentui/core`
- `@opentui/solid`
- `solid-js`

> Note: this environment currently blocks npm registry access with HTTP 403 (proxy/security policy), so dependency metadata could not be resolved from npm during this change. The lockfile was updated at the root package manifest level only; full `node_modules/*` lock entries must be generated in a network-enabled environment by running `npm install`.

## TypeScript/module-resolution compatibility check
Current compiler settings are already compatible with modern ESM package layouts commonly used by Solid/OpenTUI ecosystems:

- `"module": "NodeNext"`
- `"moduleResolution": "NodeNext"`
- `"esModuleInterop": true`
- `"allowSyntheticDefaultImports": true`

No `tsconfig.json` change is required for baseline package resolution under NodeNext.

## Bundling/build-path impact
This repository's `build` script is TypeScript type-check only (`tsc --noEmit`) and does not use a frontend bundler. As a result:

- no bundler config updates are required for the existing CLI startup/build path;
- startup path remains `node ./bin/vibe-agent.js` (`dev`/`start` scripts).

## Follow-up in unrestricted network environment
Run the following to finalize lockfile resolution:

```bash
npm install
npm run build
npm test
```

If Solid JSX files are introduced later (`.tsx`), add/update TS JSX settings then (e.g., `jsx` + `jsxImportSource: "solid-js"`) based on where TSX is compiled.
