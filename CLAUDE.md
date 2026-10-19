# gen-img-simple

SvelteKit 3 (Svelte 5 runes) + bun. Lua flows run in the browser via wasmoon.

- `bun run check` — typecheck (must be clean); `bun run build` — production build.
- Kit 3: lib imports use `#lib/...` with explicit `.js` extension for TS modules (`#lib/views.svelte.js`);
  env vars are declared in `src/env.ts` and read from `$app/env/private`.
- Script-facing Lua API lives in `src/lib/runtime/prelude.lua`; its JS bridge is `Runner.host()` in
  `src/lib/runtime/runner.svelte.ts`. Any new non-deterministic host call must go through `record()`
  so replay (answer editing) stays deterministic. Keep README's API table in sync.
- Mutating API requests send `content-type: application/json` (Kit's CSRF check rejects form-like types).
