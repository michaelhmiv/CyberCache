# Lane 1 — `e2e-browser` (CI overhaul)

Blueprint: `REPORT.md` §6.3 in the 2026-11-11 latency audit. This lane exists because the six pre-existing checks verified that code *compiles and satisfies unit contracts*, and none verified that *the game, running, does the thing* — so an invisible enemy (alpha-0 walk layer), a decrypt that could hang forever on a stalled display-only write, a black-flash stage takeover, and a gear list collapsing at owner scale all shipped through green CI.

## What it is

`.github/workflows/e2e-browser.yml` runs `scripts/e2e/run.mjs` on every PR and master push:

- **Fixture** — a real Postgres 16 service + the real Chef server (`npm run server`), which serves the production `dist` and mounts `/api` on the same origin (port 3000). Migrations are applied by `scripts/e2e/fixture.mjs` (the repo ships 92 SQL migrations and no runner; the fixture productises the migration-drill pattern and refuses any non-loopback, non-`e2e`-named database).
- **Browser** — Chromium via `playwright-core` (the repo's anim-replay pattern: `--no-save` install, no lockfile churn), SwiftShader WebGL flags, 412×915 @ DSF 2, 4× CPU throttle (CDP).
- **Session** — a fresh guest per case. Deterministic with zero seeding: the initial bundle grants every account +5,000cr / +500 scrap / **+3 cache keys** exactly once; the weakest boss's never-beaten fee is 100cr.

## Cases (each assertion is written so the audited defect FAILS it)

| Case | Assertions | Defect it trips on |
|---|---|---|
| `enemy-presence` | Pixi roam stage mounts; enemy-region pixel mass on the settled stage; stage not black; enemy HP plate changes within ~15 ticks | alpha-0 enemy; frozen plate; stranded blank stage |
| `tab-switch-budget` | Per-switch content marker ≤ 2.5s and no longtask > 1s across HOME→GEAR→MARKET→HUNTER→HOME (roaming); Pixi stage initialised **exactly once** per session; H-06: exactly one initial-bundle POST and zero ≥400 responses during bootstrap | unmount-everything shell; 4s stage rebuilds; double bootstrap |
| `decrypt` | 3 normal key opens: `cache-reveal-deck` within Sample B rarity timing + 1.5s of the reveal moment. **Sabotage A:** `PUT /api/runtime/snapshot` stalled forever → deck still lands on budget. **Sabotage B:** `POST /api/ops/make-item` delayed 10s → a recoverable state (deck or error surface), never an endless DECRYPTING | shake-forever decrypt hang |
| `gear-at-scale` | Items response expanded to 2,366 rows (the audit relay's seed-gear fixture, productised as route interception): mounted `gear-list-row` count stays windowed (≤120), visible-row art leaves `data-deferred-art="pending"` inside the settle budget at the top AND the bottom of the list, and a leave-and-return revisit shows art immediately | unwindowed 71k-node list; stage-density row art; re-trickling art |
| `boss-stage` | Real attempt on the weakest unlocked boss: `boss-fight-stage` mounts (Pixi), boss-region pixel mass present, `data-phase` advances, the C3 telegraph layer (`boss-special-layer`) is sighted during the fight, the fight reaches `data-finished` | boss-stage wiring regressions (Nov 6 class); telegraph loss |
| `market-error-state` | Wave 2 X-07: listings GETs forced to fail → an error state **with a Retry control** renders, the failure is not presented as "No listings found", and Retry re-invokes the fetch | false empty state on API failure |

Pixel presence is measured by decoding element screenshots in-page (`scripts/e2e/pixels.mjs`): non-background mass vs the region's modal colour + distinct-colour count. The production build's Pixi probe globals are `import.meta.env.DEV`-gated, so the lane deliberately depends only on shipped DOM testids + rendered pixels.

## Budgets (initial values, blueprint §6.3)

Tab marker ≤ 2.5s throttled · no longtask > 1s · stage init == 1/session · decrypt deck ≤ Sample B (Common 900 / Uncommon 1000 / Rare 1100 / Epic 1400 / Legendary 2600 ms) + 1.5s · gear visible-row art ≤ 3s at 2,366 items (shipped at 5s in the driver pending runner calibration — SwiftShader software rendering on shared runners is the one number the audit could not measure; tighten to 3s once two weeks of runner data say it holds) · enemy visible ≤ walk-in window after engagement · boss finish ≤ 150s.

## Calibration log

- **Day one (this lane's introduction):** budgets as above; the gear art-settle budget is the single deliberately-loose value (5s vs the blueprint's 3s) for the reason stated. Flake policy during calibration: a case that fails gets ONE workflow re-run before anyone touches a budget; two identical failures are a product signal, not a flake.
- Entries land here as runs accumulate (date, run, case, observation, action).

## Promotion path to REQUIRED

1. Lane runs non-required on every PR + master push (this state).
2. Calibration window: ~2 weeks of master-push runs green without budget edits, and every PR failure in the window is explained (product defect filed, or fixture bug fixed in the lane).
3. Flip branch protection: add `e2e-browser` to master's required status checks (a repo-settings change — no YAML edit needed; the job name is stable by design).
4. Lane 2 (`emulator-play.yml`) becomes required on its stage/screen paths filter in the same settings change; its nightly master run is the long-tail net.

## Running it locally

```bash
# Postgres on 127.0.0.1:5432 with a database named *e2e*, then:
npm ci
npm install --no-save playwright-core@1.49.1
npx playwright-core install chromium
npm run build
E2E_DATABASE_URL=postgres://e2e:e2e@127.0.0.1:5432/cybercache_e2e \
  node scripts/e2e/fixture.mjs apply-migrations
DATABASE_URL=postgres://e2e:e2e@127.0.0.1:5432/cybercache_e2e \
  CHEF_JWT_SECRET=dev-secret CHEF_JOB_SECRET=dev-secret PORT=3000 npm run server &
node scripts/e2e/run.mjs            # all cases, or name cases to run a subset
```

On this repo's agent VM, local Chromium is best-effort (the sandbox write filter intermittently blocks browser processes); GitHub runners are the calibration environment of record.
