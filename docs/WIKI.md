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
2. **Page-map check** (this phase, warn mode): `wiki/.page-map.json` maps
   gameplay source paths (`src/content/*`, `src/constants/*`, screens,
   server routes/gameplay) to the wiki pages that describe them. CI job
   `wiki-map-check` runs `scripts/check-wiki-map.mjs` on every PR and
   annotates (`::warning`) any mapped source that changed without one of
   its pages changing. It never fails the build in Phase 1. A PR that
   changes a mapped source with no player-visible impact opts out by
   carrying a `wiki-impact: none` line in its body.
3. **Generated pages** (Phase 3, not yet built): the data-heavy tables
   (weapon matrix, legendary effects, recipes, boss roster, slot
   paytable, …) will be rendered from `src/content/` / `src/constants/`
   by generator scripts, and CI will fail if a committed page differs
   from a fresh render. Phase 3 also flips the page-map check from
   `warn` to `fail` (the `mode` field in `.page-map.json`).

## Running the check locally

```bash
# Against your branch's diff vs master:
node scripts/check-wiki-map.mjs

# Against an explicit file list:
node scripts/check-wiki-map.mjs src/content/slots.ts wiki/Slots.md

# The list can also come from CHANGED_FILES (newline/comma separated)
# or --base <ref>.
```

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

- **Phase 1 (this):** skeleton + publish pipeline + page-map warn check
  + AGENTS.md rule.
- **Phase 2:** full prose pages replacing the stubs, section by section.
- **Phase 3:** generated reference tables + fail gate.
- **Phase 4:** Changelog automation from merged PR titles.
