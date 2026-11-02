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
3. **Generated pages** (Phase 3): the data-heavy tables are rendered
   from the game's own constants by the generators in
   `scripts/wiki-gen/` — one module per data family (weapons,
   legendary effects, consumables, recipes, bosses, areas, vehicles,
   slots, skill trees + cache rank, collections). Each generated
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
   `wiki/Reference.md` (weapons, affixes, areas, vehicles, slots) and
   the dedicated `wiki/Reference-*.md` pages (effects, consumables,
   recipes, bosses, progression, collections).

## Running the checks locally

```bash
# Page-map check against your branch's diff vs master:
node scripts/check-wiki-map.mjs

# Against an explicit file list:
node scripts/check-wiki-map.mjs src/content/slots.ts wiki/Slots.md

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
- **Phase 4:** Changelog automation from merged PR titles.
