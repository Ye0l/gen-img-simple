# gen-img-simple

SvelteKit 3 (Svelte 5 runes) + bun. Lua flows run in the browser via wasmoon.

- `bun run check` — typecheck (must be clean); `bun run build` — production build.
- Kit 3: lib imports use `#lib/...` with explicit `.js` extension for TS modules (`#lib/views.svelte.js`);
  env vars are declared in `src/env.ts` and read from `$app/env/private`.
- Script-facing Lua API lives in `src/lib/runtime/prelude.lua`; its JS bridge is `FlowRun.host()` in
  `src/lib/runtime/core.ts`, shared by the web frontend (`runner.svelte.ts`) and the CLI (`cli/main.ts`,
  run with `bun run cli`). Any new non-deterministic host call must go through `record()`/`recordSync()`
  so replay (answer editing, saved runs) stays deterministic. Keep README's API table in sync.
- `core.ts`, `zip.ts` and `src/lib/server/*` (except `env.ts`) must stay free of Svelte/SvelteKit imports:
  the CLI imports them directly under bun.
- Mutating API requests send `content-type: application/json` (Kit's CSRF check rejects form-like types).
- wasmoon: engines use `enableProxy: false` so JS values arrive in Lua as plain tables. Host functions
  must never return a bare `null` (wasmoon probes `.then` and throws) — return `undefined`.
  Empty Lua tables cross as `{}`; scripts use `json.array()` when an API needs `[]`.
- Storage: secret values never go to the browser; the http proxy substitutes `{{secret:name}}`.
  `DATA_DIR` (default `./data`) is gitignored.
