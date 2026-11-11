# Painted weapon sources (Top-Choice INT-1)

The wiki generator's art sources for the weapon plates: the adopted
Top-Choice paintings for the 26 named legendaries (`legendary/`) and
the 36 type x manufacturer bases (`frames/`), fitted by
`scripts/wiki-gen/images.ts` / `images-w5.ts` into the published
480x176 plates under `wiki/images/weapons/`.

Each file is a production derivation of an adopted wave master:
keyed with the program's validated `key_white` (true alpha),
content-cropped, resized to the books' 1440 px card-width shipping
class (downscale only), and palette-256 compressed (PIL FASTOCTREE).
`sources.json` records, per file, the master it derived from and the
measured sizes.

Re-derive (deterministic; needs the Top-Choice prep tree, whose
masters live outside the repo):

    python3 scripts/wiki-gen/derive-weapon-paintings.py [TOP_CHOICE_ROOT]

Adopted masters: legendaries — `wave1-legendaries/renders/<slug>-top.png`
for 11, `wave1-5-silhouette/renders/<slug>-top.png` for the 15
silhouette-pass replacements (consolidated ledger D-3 composition:
8,084,274 B palette-256 at native size); bases —
`wave2-weapon-bases/renders/<type>-<maker>-top.png` (4,611,563 B;
pistol-redline's canonical file is the adopted flat-profile v2).

These files are wiki sources, not app payload: they are not in the
sprite manifest and ship nowhere in the game bundle. The 1440 px class
is the card width both weapon books measured as the realistic shipping
class, so the same files are the production card assets if a future
slice wires the paintings into the game's renderers — see
`docs/top-choice-weapon-integration.md` for that decision record.
