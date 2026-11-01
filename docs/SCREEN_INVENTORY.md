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

- `reached: true` — the screen rendered and was captured.
- `reached: false` — the stop could not be reached; `note` says why. A
  miss never fails the job by itself. The job only goes red when no
  `manifest.json` exists at all (app didn't launch, guest home never
  rendered, or the pull failed).

## How the crawl works

`ScreenInventoryTest` (`android/app/src/androidTestInventory/java/com/michaelhmiv/cybercache/`)
launches the app, taps **Continue as Guest**, dismisses first-run
surfaces (starter-bundle reveal → *Collect*; a pending offline recap →
*Got it*), and then walks the app by **visible text and content-desc**
via UiAutomator — the same labels a user sees (bottom-nav labels come
from `src/constants/navSigils.ts`: Board / Action / Gear / Market /
Rank / Hunter).

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

### Guest locks you will see in the inventory

The crawl runs as a **guest**, so the inventory shows the guest truth of
the shipped UI: on the Market tab everything except the **Vendor** is
locked ("sign in to use the player market"). `market-buy`,
`market-repair`, and `market-shield-tech` are therefore recorded
`reached: false` with a screenshot of the guest state after tapping the
tab. A signed-in crawl variant is a deliberate follow-up, not an
accident to fix in this test.

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
| `board-home` | Guest entry → Board top (resource bar, area chip, level strip) |
| `board-area-picker` | Board → current-area chip ("Change area") |
| `board-panels` | Board scrolled — Login Streak + Contracts panels |
| `settings` | Board quick action "Settings" (sub-screen "Options Board") |
| `crack-cache` | Board quick action "Crack Cache" (the cache lane) |
| `dispatch` | Board quick action "Dispatch" |
| `action-main` | Action tab |
| `action-roaming` | Action stage → Start Roam |
| `action-switcher` | Action → "Switch Action" sheet |
| `action-extraction` | Switcher → Extraction |
| `action-crafting` | Switcher → Crafting |
| `boss-select` | Switcher boss row, or Board diorama "Choose Boss" |
| `boss-prep` | First boss row (prep only — the fight is never started) |
| `gear-loadout` | Gear tab → Loadout |
| `gear-garage` | Loadout scrolled → Garage section |
| `gear-grid` | Gear tab → Gear |
| `gear-inspect` | First item card → inspect sheet |
| `gear-items` | Gear tab → Items |
| `gear-workshop` | Gear tab → Workshop |
| `market-vendor` | Market tab → Vendor |
| `market-buy` | Market → Buy (guest-locked, see above) |
| `market-repair` | Market → Repair Services (guest-locked) |
| `market-shield-tech` | Market → Shield Tech (guest-locked) |
| `rank-leaderboards` | Rank tab |
| `rank-scrolled` | Rank tab scrolled |
| `hunter-profile` | Hunter tab top (Trophy Shelf + stat cards) |
| `hunter-cache-rank` | Hunter scrolled → Cache Rank panel |
| `hunter-research` | Hunter scrolled → Research panel |
| `hunter-skill-trees` | Hunter scrolled → embedded Skill Trees |
| `hunter-account-tools` | Hunter scrolled → Account Tools |
| `collections` | Hunter → Account Tools → Collections |

## Maintaining the map

When a screen is added, renamed, or moved:

1. Add/adjust a `stop(...)` block in `ScreenInventoryTest.crawlAllScreens()`
   — stops are deliberately independent; one broken stop must only ever
   cost its own manifest entry.
2. Navigate by the **user-visible label** (text or content-desc), with a
   fallback label if the copy has variants. If a label is renamed in
   `src/`, update the crawl in the same PR.
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
the emulator, so a broken crawl fails fast and cheap. The first live
dispatch after this harness lands is its shakedown run: expect the
manifest to be the source of truth about which stops need label fixes,
and iterate from there.

Launch robustness note: the crawl's first-paint wait is 120s and accepts
either auth affordance or a live session — on a freshly booted emulator,
WebView init + bundle load + the first session check against the live
Chef can exceed the naive 45s this started with (that shorter wait is
what killed the accidental per-PR run). If the wait still expires, the
test captures a `launch-failure` screenshot + hierarchy into the
inventory before failing, so the artifact shows what was actually on
screen.
