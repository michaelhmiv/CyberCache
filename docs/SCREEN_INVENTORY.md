# Screen Inventory — on-demand emulator crawl

The screen inventory is how design review gets **real renders of the real
app**: screenshots of every screen, taken from the actual Android APK
running on a Pixel 7 emulator. It exists so nobody has to judge a screen
from a description, a mock, or a golden-scene board again.

## How to run it

1. GitHub → **Actions** → **Screen Inventory** → **Run workflow**
   (pick the branch you want inventoried — usually `master`).
2. Wait for the run (~10–20 minutes: web build, APK build, emulator
   boot, then the crawl itself).
3. Download the **`screen-inventory`** artifact from the run page.

It is **manual-dispatch only, on purpose** (owner directive, 2026-11-01).
It is not part of per-PR CI: a full crawl costs minutes of emulator time
and its output is design evidence, not a merge gate. The ordinary
`android-emulator` job in `android-ci.yml` still boots the app on every
PR — it just doesn't crawl or keep screenshots.

## What the artifact contains

For every crawl stop, in visit order:

- `NN-<screen>.png` — the screenshot (Pixel 7, 1080×2400).
- `NN-<screen>.xml` — the UiAutomator window-hierarchy dump for the same
  moment (what text was actually on screen — the crawl's own evidence).
- `manifest.json` — the index. One entry per stop:

```json
{ "file": "07-action-main.png", "screen": "action-main", "reached": true, "note": "…" }
```

- `reached: true` — the screen rendered and was captured, with the
  stop's own anchor element verified visible in the viewport at the
  capture instant and no modal/sheet layer covering it (unless the
  modal/sheet is the stop's named subject). The verifying anchor is
  named in the `note`.
- `reached: false` — the stop could not be reached; `note` says why
  (it is always the reason from the stop's second, re-anchored
  attempt). The job goes red when no `manifest.json` exists at all
  (app didn't launch, guest home never rendered, or the pull failed)
  **or when fewer than `MIN_REACHED_STOPS` (28) of the 32 stops are
  reached** — see "The coverage gate" below.

## How the crawl works

`ScreenInventoryTest` (`android/app/src/androidTestInventory/java/com/michaelhmiv/cybercache/`)
launches the app, taps **Continue as Guest**, captures the first-run
starter-bundle reveal as its own named stop (`starter-bundle-reveal`)
before dismissing it via *Collect*, and then walks the app by
**verified visible text** via UiAutomator — the same labels a user
sees (bottom-nav labels come from `src/constants/navSigils.ts`: Board /
Action / Gear / Market / Rank / Hunter).

### The verification contract (why run 1's 7/32 is not repeatable)

Run 1 (2026-11-01) reported 7 of 32 stops "reached", but 6 of those 7
captures were the wrong layer or the wrong screen — most visibly
`board-home`, which showed the starter reveal modal still open over a
blurred Board. The crawl was rewritten around three rules:

- **Verified find.** Every lookup goes through a viewport-bounds
  filter: a node only counts when its visible bounds intersect the
  viewport inside the caller's vertical band. Candidates prefer
  clickable nodes, then the shortest label (the most specific node).
  Selectors are the strings this WebView actually exposes: aria labels
  surface as node **text** (content-desc is empty), matching is
  case-sensitive (Board rows are `"SETTINGS"`, diorama actions are
  `"START ROAM"` / `"CHOOSE BOSS"`, switcher rows are `"Extract"` /
  `"Craft"` / `"Boss Prep"`), and tab nodes are single glyph+label
  nodes (`"▣ GEAR"`) found by contains-match inside the bottom band.
  Hierarchy *dumps* are evidence, not truth: run 1's dumps omitted
  modal subtrees entirely while the modal was visibly on screen.
- **Anchor discipline + modal gate.** Before every stop the crawler
  re-taps the stop's tab (verified against a tab-specific anchor),
  scrolls to top (bounded), and clears modal/sheet layers. Capture
  itself re-verifies: no covering modal (unless the modal is the
  stop's named subject) and the stop's own anchor visible *now*. A
  failed stop is retried once from a re-anchored state; the manifest
  records the second attempt's reason. Below-the-fold targets use
  swipe-and-scan scroll-search (≤6–12 swipes by panel depth); the note
  records the swipe count when it took more than zero.
- **The reveal is a subject, not an obstacle.** `starter-bundle-reveal`
  is captured before dismissal. If its controls never surface in live
  queries, the crawl probes Board interactivity behaviorally (tap the
  area chip; does *Choose Area* open?): probe-pass means no modal was
  covering and the stop is an honest miss; probe-fail means a covering
  modal is certain, the current screen is captured as the stop, and
  dismissal falls back to a bounds-relative tap on the Collect
  position measured from run 1's captures — flagged in the note as a
  last-resort bounds tap.

### The coverage gate

The workflow's verify step parses `manifest.json`, prints the reached
count and every missed screen's name + reason to the job summary, and
**fails the run when reached < `MIN_REACHED_STOPS`** — a named constant
in the `env:` block at the top of
`.github/workflows/screen-inventory.yml`, currently **28 of 32**. A
partial inventory can no longer report success.

**Why `androidTestInventory`, not `androidTest`:** the class must never
run in per-PR CI. It lives in its own source dir that joins the
`androidTest` source set only when Gradle is invoked with
`-PincludeScreenInventory` (see the `sourceSets` block in
`android/app/build.gradle`); the screen-inventory workflow's compile
step passes that property. Without it the class is not compiled into
the test APK at all, so `connectedDebugAndroidTest` (the per-PR
emulator job) cannot pick it up — when the class still lived in
`androidTest`, PR #251's own emulator check ran the whole 32-stop
crawl and failed. Ordinary instrumented tests (e.g.
`ExampleInstrumentedTest`) stay in `src/androidTest` and run per-PR
exactly as before.

The crawl is read-only in spirit: it never buys, sells, salvages, or
starts a boss fight. On the throwaway guest account it does claim the
starter bundle and may start roaming / switch the current action —
exactly what a first-run user does in their first minutes.

### What guests see (post-PR #254)

The crawl runs as a **guest**, and since PR #254 (guest-visibility
law) guests see **everything with real data** — player market, repair
board, shield-tech, leaderboards, all screens. Only *transacting*
(buy/sell/list/post/accept/order) requires sign-in, with the lock
presented at the action itself. `market-buy`, `market-repair`, and
`market-shield-tech` are therefore ordinary reached stops, verified by
their board bodies rendering (e.g. "Open postings"), not by their tab
labels. A signed-in crawl variant remains a possible follow-up for
transacting surfaces, not a fix this test needs.

### Where files live on the device

The test writes to the app's external files dir:

```
/sdcard/Android/data/com.michaelhmiv.cybercache/files/screen-inventory/
```

`manifest.json` is rewritten after **every** stop, so even a crawl that
dies halfway leaves a truthful partial manifest. The workflow pulls the
directory with `adb pull` after the instrumented run (with an
`adb root` best-effort first — emulator images allow it, and it makes
the `Android/data` read reliable).

## The crawl map

In visit order (stop name → how it's reached):

| Stop | Route |
| --- | --- |
| `auth` | Launch |
| `starter-bundle-reveal` | First-run "Loot Secured" modal — captured as its own subject, then dismissed via Collect |
| `board-home` | Guest entry → Board top (resources, area chip, DashboardTopBar) |
| `board-area-picker` | Board → current-area chip (aria "Current area: …") → "Choose Area" sheet |
| `board-panels` | Board scrolled until ACTION BOARD / HUNTER TOTALS is in the viewport |
| `settings` | Board nav row "SETTINGS" (screen "Options Board") |
| `crack-cache` | Board nav row "CRACK CACHE" (cache lane, heading "Data Cache") |
| `dispatch` | Board nav row "DISPATCH" ("Dispatch Bay") |
| `action-main` | Action tab (verified by the "Switch Action" button) |
| `action-roaming` | Standby card "Start Roam" → verified "Roaming Loot" stage state |
| `action-switcher` | Action → "Switch Action" sheet |
| `action-extraction` | Switcher → "Extract" row → Extraction panel |
| `action-crafting` | Switcher → "Craft" row → Crafting panel |
| `boss-select` | Action "Choose Boss" button, switcher "Boss Prep" row, or Board diorama "CHOOSE BOSS" → "Choose Boss Target" picker |
| `boss-prep` | First boss row in the picker (prep only — the fight is never started) |
| `gear-loadout` | Gear tab → Loadout |
| `gear-garage` | Loadout scrolled → Garage section |
| `gear-grid` | Gear tab → Gear |
| `gear-inspect` | First item card → inspect sheet |
| `gear-items` | Gear tab → Items |
| `gear-workshop` | Gear tab → Workshop |
| `market-vendor` | Market tab → Vendor |
| `market-buy` | Market → Buy (guest-visible since PR #254) |
| `market-repair` | Market → Repair Services (guest-visible since PR #254) |
| `market-shield-tech` | Market → Shield Tech (guest-visible since PR #254) |
| `rank-leaderboards` | Rank tab ("Leaderboards") |
| `hunter-profile` | Hunter tab top (Trophy Shelf + stat cards) |
| `hunter-cache-rank` | Hunter scrolled → Cache Rank panel |
| `hunter-research` | Hunter scrolled → Research panel |
| `hunter-skill-trees` | Hunter scrolled → embedded Skill Trees |
| `hunter-account-tools` | Hunter scrolled → Account Tools |
| `collections` | Hunter → Collections row (near Account Tools) |

`rank-scrolled` from the original map was retired in the hardening
rewrite: it was a pure scroll-variant of the Rank tab and the least
distinct subject on the map; `starter-bundle-reveal` took its slot,
keeping the map at exactly 32 stops. Recommended next map addition:
the DashboardTopBar streak and contracts pop-up sheets (#253) as their
own stops — their anchors are the top-bar icon buttons ("Daily streak —
…", "Contracts — …") and the real LoginStreakPanel / ContractsPanel
inside the sheets.

## Maintaining the map

When a screen is added, renamed, or moved:

1. Add/adjust a `stop(...)` block in `ScreenInventoryTest.crawlAllScreens()`
   — stops are deliberately independent; one broken stop must only ever
   cost its own manifest entry. A stop body navigates, then returns
   `capture(...)` with the stop's own anchor(s): never record a stop
   reached from a bare tap or a fixed scroll.
2. Navigate by the **label the WebView actually exposes** (aria →
   node text; check case and glyph prefixes), with a fallback label if
   the copy has variants. If a label is renamed in `src/`, update the
   crawl in the same PR.
3. Update the table above.
4. Re-dispatch the workflow and eyeball the new stop's PNG + the
   manifest entry before trusting it.

Known fragility, by design: labels are matched against the WebView
accessibility tree. Purely visual surfaces with no text (some diorama
states) can't be targeted directly — target the labeled control that
opens them instead, as the boss-prep stop does.

## Verification status

The workflow compiles both APKs (`assembleDebug` +
`assembleDebugAndroidTest -PincludeScreenInventory`) **before** booting
the emulator, so a broken crawl fails fast and cheap. Run 1 (the
harness's shakedown, 2026-11-01) reached 7 of 32 with 6 false-positive
captures; the crawl was then rewritten under the verification contract
above and the workflow gained the `MIN_REACHED_STOPS` gate. The
hardened crawl's own verification is the next live dispatch: this
environment has no KVM, so the rewrite is compile-verified locally and
proven by the manifest of the first post-merge run.

Launch robustness note: the crawl's first-paint wait is 120s and accepts
either auth affordance or a live session — on a freshly booted emulator,
WebView init + bundle load + the first session check against the live
Chef can exceed the naive 45s this started with (that shorter wait is
what killed the accidental per-PR run). If the wait still expires, the
test captures a `launch-failure` screenshot + hierarchy into the
inventory before failing, so the artifact shows what was actually on
screen.
