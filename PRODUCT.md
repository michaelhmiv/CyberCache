# PRODUCT.md — CyberCache

**Status: owner-ratified direction, 2026-11-01.** This document holds the
product truths every design and implementation decision in this repo must
respect. The design system that expresses them is `DESIGN.md`; the
architecture rules are in `docs/ARCHITECTURE.md`.

(Provenance: drafted by the redesign pass from the owner's governing brief
and session record; ratified by the owner on 2026-11-01 with the four-tab
structure decision and the market/economy rulings below folded in.)

## Product truth

- **What it is:** a mobile-first idle roguelite looter RPG — Borderlands-style
  itemization (rarity ladder, makers, elements, rolls) wrapped around
  idle-game loops (Melvor / NGU Idle / Idle Slayer conventions). North star,
  owner's words: *a Borderlands idle game.*
- **Who it serves:** the hunter who checks in many times a day for short
  sessions and one long one — progress must read at a glance, claims must
  never hide, and the loot moment (beam, card, rarity) is the emotional core.
  Loot drops are THE moment; everything else supports them.
- **Pace law:** a long-term game, not maxed in 30 days — level 100 is roughly
  two years of regular play; the post-campaign (bosses, collections, endless,
  markets) is the real game.
- **Structure (decided 2026-11-01):** four tabs — **Home · Gear · Market ·
  Hunter.** Home is the merged Board + Action: choose a place, get the
  immediate rundown, hunt. Rank lives inside Hunter as the Standings door.
  Every feature has exactly one canonical door and nothing is buried;
  `DESIGN.md` §3/§9 carry the maps and the surfacing rules.
- **Access law (guest visibility):** guests see everything with real data;
  only transacting requires sign-in, and the lock is presented at the action,
  never as a hidden screen. Sign-in is Google (Android) / Apple (iOS);
  guest start stays, and guest progress links to the same account later.
  Crafting requires no verified account.
- **Intel law:** boss prep shows the boss's facts — effects, mechanics,
  stats — never a computed readiness or win chance.
- **Economy shape:** occupations are real specializations (one action at a
  time — roam OR craft OR boss/endless; dispatch stays parallel; research
  runs on its own education track); crafted goods and the player market carry
  the high end; the NPC vendor sells baseline generics at flat 100% quality;
  a 5% market fee on completed sales is the credit sink.
- **Everything-sellable market (ruled 2026-11-01):** every inventory resource
  trades on the player market — gear, consumables, materials, essences,
  cache fragments, and legendary cores included. Credits are the sole trade
  medium. The boundary: inventory items and resources are tradable; profile
  numbers (standing balance, cache-rank tokens, mastery, research progress)
  are soulbound and never listable. Every core in existence still cost one
  salvaged legendary to mint, so trading cores does not break the prestige
  sink.
- **Credit drops stay (ruled 2026-11-01):** roaming credit drops remain the
  base faucet. Credits are not minted only through NPC vendor sales — that
  would concentrate the entire money supply in one price list and trap
  broke players against credit-charged resurrection, rematch, and research.
- **Services are open markets:** there is no NPC mechanic. Repair and
  shield-tech work runs through the player service boards (patch kits and
  calibration cores are the consumables), and those boards carry the same
  filters, sorting, searching, and on-the-card requirements as every other
  market lane.
- **Monetization lane:** cache boxes are the ad lane (1 free box daily,
  ad/key boxes up to 10/day) — never ads on the play screen, and caches are
  never loot drops. A future subscription may sell convenience/flow only,
  never power or access.
- **Information stays current:** the public wiki (source in `wiki/`, synced
  to the GitHub Wiki on merge) is the player's reference, and gameplay-
  visible changes update it in the same PR (see `AGENTS.md`).
- **Voice:** concise, direct, in-world. Data is printed plainly (odds on the
  machine, pay on the contract). No developer language ever reaches player
  copy.
- **Judged on looks:** the owner evaluates design purely on how it looks —
  visual polish, type, color, structure — with real rendered examples, on a
  phone-width screen, in a real flow. UI work is not done at renderer-green;
  it is done when the phone-width flow has been tapped through (and, for the
  redesign, when it conforms to `DESIGN.md`).
