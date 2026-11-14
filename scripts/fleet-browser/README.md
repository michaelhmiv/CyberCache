# Fleet browser session type

Blueprint: `REPORT.md` §6.3, fleet tie-in. The staging fleet asserts at the API level and is structurally blind to browser-state defects (561 audited sessions, zero UI-flow references). This session type is the fleet's one browser-driven member.

## What it does

`session.mjs` serves the repo's production `dist` locally, proxies `/api` to the **staging** Chef, and plays a short guest session in Chromium (SwiftShader), asserting:

1. **Roam** — the stage mounts, its pixels change across a fight window, and the enemy region carries actor mass.
2. **Cache** — one key open (guests hold 3 keys from the initial bundle) and the reveal deck appears within the Sample B + 1.5s budget.

It prints one fleet-shaped JSON record (`{type: "browser", at, ok, chef, assertions[]}`) to stdout and appends it to `$FLEET_BROWSER_OUT` when set. Exit code mirrors `ok`.

## Running it

```bash
npm ci && npm run build
npm install --no-save playwright-core@1.49.1
npx playwright-core install chromium
FLEET_BROWSER_OUT=fleet-runs/browser.jsonl node scripts/fleet-browser/session.mjs
```

Env knobs (`FLEET_CHEF_URL`, `DIST_DIR`, `FLEET_PORT`) are documented in the file header. Defaults target the staging Chef; **do not point this at production** — it creates a guest account and opens a cache wherever it runs, which is staging-appropriate and production-hostile.

## Adoption note (for the fleet owner)

This type ships un-wired on purpose: the overhaul delivers the session type, the fleet's cron/owner decides cadence. Suggested adoption: one browser session per fleet cycle alongside the five API archetypes, ingesting the JSONL record as a sixth session line; alert on `ok: false` under the fleet's existing anomaly rules. It uses a fresh guest each run, so it never touches the archetype accounts or their stored credentials.
