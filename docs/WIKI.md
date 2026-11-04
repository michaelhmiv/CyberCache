# The CyberCache Wiki — how it works (dev-facing)

The player-facing wiki lives at the repo's GitHub Wiki, but **nobody edits
it there**. Its source of truth is the `wiki/` directory in this repo, and
it is published by CI. This doc explains the machinery; the design rationale
is in the wiki brief (2026-11-01).

## Layout

- `wiki/*.md` — one file per wiki page. File names map to wiki page names
  (`Actions-and-Occupations.md` → "Actions and Occupations"). `Home.md` is
  the wiki front page and `_Sidebar.md` is its navigation.
- `wiki/.page-map.json` — the feature→page map (below). Repo-side tooling;
  the publish workflow excludes it from the wiki.
- `wiki/.sync-sha` — written by the publish workflow at publish time: the
  master commit the published pages came from. Every page footer points
  readers at it.
- `scripts/check-wiki-map.mjs` — the drift check.
- `scripts/wiki-gen/` — the Phase 3 table generators (below).
- `.github/workflows/wiki-publish.yml` — the publish pipeline.

## Publishing

On any push to `master` that touches `wiki/**` (or the workflow itself),
`wiki-publish.yml` clones `<repo>.wiki.git`, stamps `wiki/.sync-sha` with
the master SHA, mirrors `wiki/` into the clone with `rsync --delete`
(so deleted pages disappear from the wiki too), and commits/pushes if
anything changed. It can also be run manually via `workflow_dispatch`.

**First-run quirk:** GitHub does not create the wiki git repository until
the wiki's first page exists. If the wiki has never been initialized, the
clone step fails and the workflow prints the remedy: create one page via
the repo's **Wiki tab** in the GitHub UI (any content — the first sync
overwrites it), then re-run the workflow.

Never edit the published wiki through the GitHub UI: the next sync
overwrites UI edits without warning. All changes go through PRs here.

## Keeping it updated — the three layers

1. **Standing rule** (repo `AGENTS.md`): any change to a gameplay-visible
   fact — a system, screen, number, name, or rule — updates its wiki page
   in the same PR. The completion gate includes the wiki check.
2. **Page-map check** (fail mode since Phase 3): `wiki/.page-map.json` maps
   gameplay source paths (`src/content/*`, `src/constants/*`, screens,
   server routes/gameplay) to the wiki pages that describe them. CI job
   `wiki-map-check` runs `scripts/check-wiki-map.mjs` on every PR and
   **fails the build** when a mapped source changed without one of its
   pages changing. A PR that changes a mapped source with no
   player-visible impact opts out by carrying a `wiki-impact: none`
   line in its body. (Phase 1 shipped this in warn mode; Phase 3
   flipped the `mode` field in `.page-map.json` to `fail`.)
3. **Changelog automation** (Phase 4): `wiki/Changelog.md` is kept
   honest by two mechanisms in `scripts/wiki-gen/changelog.ts`, both
   riding the `wiki-gen-check` gate. (a) The **merge ledger**: a
   generated block at the foot of the Changelog listing every master
   merge since PR #262 / 2026-11-01, recorded as master's merge
   history carries it. `npm run wiki:gen` harvests the local git
   history into the committed snapshot
   `scripts/wiki-gen/changelog-ledger.json` and renders the block
   from it; `--check` re-renders from the snapshot only, so the gate
   stays deterministic. (b) The **staleness tripwire**: the
   `wiki-gen-check` job checks out with `fetch-depth: 0`, and the
   gate fails when the newest first-parent master merge's date
   (America/New_York) is newer than the Changelog's newest dated
   heading. The remedy is a hand-written entry for the missing day —
   player-facing themes like the existing entries; a day whose
   merges were all internal still gets a one-line "Under the hood"
   entry — plus a `wiki:gen` run to refresh the ledger. Regenerating
   alone cannot silence the tripwire: it reads git, not the page.
   Why not the original design (the publish workflow appending live
   PR titles)? A freshness gate must be a deterministic function of
   the checkout: the check job's default checkout is one commit deep
   (no merge history, no API token), and "merged PRs as of now"
   changes with every unrelated merge, which would fail the gate on
   master after every merge until a follow-up landed. The
   ledger + tripwire pair keeps the promise — the page cannot
   silently lapse — in a form the gate can actually enforce.
4. **Generated pages** (Phase 3): the data-heavy tables are rendered
   from the game's own constants by the generators in
   `scripts/wiki-gen/` — one module per data family (weapons,
   legendary effects, consumables, recipes, bosses, areas, vehicles,
   skill trees + cache rank, collections). Each generated
   block sits in its page between marker comments:
   `<!-- GENERATED from <owner files> — do not edit by hand -->` and
   `<!-- wiki-gen:<id> -->` … `<!-- /wiki-gen:<id> -->`. **Never edit
   inside the markers** — the next regeneration overwrites it. Run
   `npm run wiki:gen` after changing game data and commit the
   regenerated pages in the same PR. CI job `wiki-gen-check`
   (`npm run wiki:gen:check`) re-renders everything and fails if a
   committed page differs from a fresh render; generation is
   deterministic (source order, no timestamps), so a failure always
   means data moved and the page did not. The tables live in
   `wiki/Reference.md` (weapons, affixes, areas, vehicles) and
   the dedicated `wiki/Reference-*.md` pages (effects, consumables,
   recipes, bosses, progression, collections).

## Running the checks locally

```bash
# Page-map check against your branch's diff vs master:
node scripts/check-wiki-map.mjs

# Against an explicit file list:
node scripts/check-wiki-map.mjs src/content/vehicles.ts wiki/Reference.md

# The list can also come from CHANGED_FILES (newline/comma separated)
# or --base <ref>.

# Regenerate every generated table after a data change:
npm run wiki:gen

# Verify the committed tables match a fresh render (the CI gate):
npm run wiki:gen:check
```

## Adding a generated table (a new data family)

1. Add `scripts/wiki-gen/<family>.ts` exporting a `GenBlock`
   (`{ id, owners, render }`). Import the data from the same module
   the game reads — never copy values into the generator. Formatting
   helpers (tables, percents, multipliers) live in
   `scripts/wiki-gen/lib.ts`.
2. Register the block in `scripts/wiki-gen/generate-all.ts` against
   its page (a `wiki/Reference*.md` page, or a section of
   `wiki/Reference.md`).
3. Seed the page with the marker scaffold — the GENERATED-from line
   directly above `<!-- wiki-gen:<id> -->` and an empty body before
   `<!-- /wiki-gen:<id> -->` — then run `npm run wiki:gen` to fill it.
4. Add the family's owner files to `wiki/.page-map.json`, pointing at
   the page that now carries the table, and link the page from
   `wiki/_Sidebar.md` if it is new.
5. If a family genuinely cannot be imported as a module (a value that
   only exists inside a SQL migration, say), generate from the closest
   structured source and say so in the generator's header comment —
   a silent hand-copy defeats the entire mechanism.

## Adding an image family (illustrated tables)

1. Render the plates in `scripts/wiki-gen/images.ts` (or a family
   module beside it) from the game's own art sources — the sprite
   files, their manifests, and the game's own renderers and codecs
   (`src/lib/pixel/`). Never hand-make or hand-copy art into the
   wiki: if the game cannot produce the image, the wiki does not
   show it. A module that only exists inside Vite (e.g.
   `src/lib/pixel/manifest.ts`, which calls `import.meta.glob`) is
   parsed from source text instead, and the generator says so in
   its header — the same escape hatch as generated tables.
2. Return the plates from the owning block's `assets` hook as
   `GenAsset[]` (`{ path, bytes }`, path relative to `wiki/`).
   `generate-all.ts` writes them under `wiki/images/<family>/`
   with item-id (kebab-case) filenames, byte-compares them in
   `--check` mode, and deletes orphans from managed directories —
   so `npm run wiki:gen` / `wiki:gen:check` cover images with no
   workflow change, and the publish rsync carries `wiki/images/`
   to the published wiki automatically. Hard cap: **25 MB total**
   for `wiki/images/`.
3. Rendering must be byte-deterministic: fixed seeds, integer math,
   no timestamps. Generate at plate size (downscale from the source
   art; do not commit native-size art files). The acceptance test
   is a double render from clean state with a zero byte diff.
4. Embed with `<img src="images/…">` inside generated tables (it
   carries an exact display width) or `[[images/…]]` on prose
   pages. Plain relative `![](…)` embeds are flaky on the published
   wiki — do not use them. Every illustrated page must still read
   perfectly with images unloaded: names and numbers carry the
   meaning, plates only illustrate.

## UI orientation plates (`wiki/images/ui/`, W7)

One deliberate exception to the generated-image rules above: the
**UI plates** are 412-px screenshots of the shipped game, embedded
as orientation art in Getting-Started / The-Board / Gear /
The-Market. A screenshot cannot be byte-deterministic (live market
data, tick state), so these are **not** produced or checked by
`wiki:gen` — do not wire them into a generator. They are committed
as static images and kept honest two ways:

- **Freshness coverage:** the page-map entries for the screens they
  depict (HomeScreen, InventoryScreen, MarketScreen, WorkshopScreen,
  ProfileScreen, `src/components/fight/`) list the pages that embed
  the plates, so a PR that changes one of those screens is flagged
  to revisit the page — and its plate.
- **Recapture path:** `scripts/wiki-gen/capture-ui-plates.mjs`
  rebuilds the set end to end (client build from current master,
  same-origin relay to the real Chef, guest session, real UI
  driving, PIL downscale to 412 px). Its header documents the
  prerequisites and the exact post-processing. Recapture after any
  redesign of a depicted screen and commit the new plates with the
  page edits.

## Adding a page

1. Create `wiki/<Page-Name>.md` (hyphens for spaces; wiki links use the
   page title: `[[Actions and Occupations]]`).
2. Give it the standard shape: title, an accurate summary of the shipped
   system, and the footer — `_Source of truth: <owning files>._` plus the
   sync note. Numbers must match the code; verify against the owning
   constants before writing them.
3. Link it from `wiki/Home.md` and `wiki/_Sidebar.md`.
4. If the page describes a system with code, add a `sources → pages`
   entry in `wiki/.page-map.json` so the drift check watches it.
5. Open the PR as usual; merging to master publishes it.

## Phases

- **Phase 1:** skeleton + publish pipeline + page-map warn check
  + AGENTS.md rule.
- **Phase 2:** full prose pages replacing the stubs, section by section.
- **Phase 3 (this):** generated reference tables (`scripts/wiki-gen/`)
  + the `wiki-gen-check` freshness gate + the page-map check flipped
  from `warn` to `fail`.
- **Phase 4:** Changelog automation — a generated merge ledger in
  `wiki/Changelog.md` plus a CI staleness tripwire, so the page can
  never silently lapse again (see "Keeping it updated", layer 3).
