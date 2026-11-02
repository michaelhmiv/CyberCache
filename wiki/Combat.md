# Combat

Combat in CyberCache is resolved for you: roaming ticks, boss attempts, and endless encounters are all settled from your real, equipped loadout — you build the hunter, the game runs the fight. That makes two things worth understanding properly: how your damage is built (the DPS chain) and how you stay alive (HP, shields, and shield behaviors). Everything on this page is a rule the engines actually use, not flavor text.

For how a specific fight reads before you commit, see [[Bosses|boss intel]]. For where fights fit in your day, see [[Actions and Occupations]].

## The DPS chain

Every damage-per-second number in the game — gear inspect, loadout screen, boss prep — comes from one chain, applied to each weapon in this order:

1. **Raw DPS** — base damage × attack speed, increased by critical hits (crit chance × crit damage).
2. **Status contribution** — status chance and status damage add a flat multiplier on top.
3. **Signature mechanic** — your weapon's signature behavior (charges, bursts, and similar), where it has one.
4. **Manufacturer legendary multiplier** — a legendary weapon's manufacturer damage bonus, when it applies.
5. **Element matchup** — against the target in front of you (see below).
6. **Ammo-window efficiency** — a weapon that spends part of a fight reloading deals less than its paper DPS over that fight.
7. **DPS consumables** — the damage consumables you prepared, read at the quality of the actual units you burn. A higher-quality unit is worth more than a flat one.
8. **Boss damage modifiers** — per-weapon boss-damage affixes, when the target is a boss.

Because every step multiplies the previous result, small bonuses compound — and a bad matchup at step 5 taxes everything underneath it. "Standard target" DPS (the number on a gear card) is this chain against a target with no weakness, no resistance, and no consumables involved. Boss-relative DPS is the same chain with the boss's matchup and your boss affixes switched on, which is why a weapon can look ordinary on its card and be the right pick for a specific fight.

## Elemental matchups

There are six elements: Kinetic, Fire, Shock, Corrosive, Cryo, and Void. Against any given boss, your weapon's element lands in exactly one of three states:

- **Weakness match** — your element is one of the boss's weaknesses: **1.3× damage**.
- **Resisted** — your element is one of the boss's resistances: **0.7× damage**.
- **Neutral** — everything else: **1.0× damage**.

If a boss lists several weaknesses, the first matching one gives the full counter bonus — matching twice does not stack. A boss's weaknesses and resistances are printed in its intel before the fight (see [[Bosses]]), so the matchup is a loadout decision you make on purpose, not a surprise.

## Staying alive: HP and mitigation

Your maximum HP comes from one formula, used everywhere:

**Max HP = 700 + 60 × your level + your shield's HP**

At level 1 with no shield that is 760 HP; the shield you equip adds its capacity directly on top. Your shield's **mitigation** then reduces the damage that gets through, capped at 80% — mitigation is why two hunters with the same HP pool can have very different survival in practice.

One honest warning about a stat you will see on shield cards: **recharge rate is displayed, but no combat engine currently consumes it.** Shields do not passively recharge during a fight. Shield HP comes back through Shield Cell and Nano Swarm consumables — in roaming and in boss fights alike — so plan your belt accordingly and do not pay extra for a recharge number.

## Shield behaviors

Every shield is generated with one of five behaviors, shown on its card with its real numbers. Older shields with no behavior read as Standard. Behavior odds improve with rarity: Common shields are mostly Standard, while a Legendary shield always rolls one of the four real behaviors. A behavior can later be changed through [[Shield-Tech]].

- **Standard** — no special behavior. The shield is its capacity and mitigation, nothing more.
- **Nova** — when the shield breaks, it erupts for damage equal to **150% of its capacity**. It can burst again only after the shield has been restored above **50%** of capacity.
- **Absorb** — each hit taken while the shield is up has a **15% chance to be fully absorbed**, and an absorb restores **5% of capacity** in shield HP.
- **Amp** — while your shield is at **full charge**, your damage is increased by **25%**. The moment the shield takes a hit, the bonus is gone until it is full again — Amp rewards builds that avoid or restore damage quickly.
- **Turtle** — capacity is multiplied by **1.5×**, at the cost of a halved recharge-rate stat. Given the recharge note above, in current fights Turtle is effectively the big-pool option: more shield HP up front, nothing else changes.

## Action skills

Each of the four skill trees has a signature action skill. You qualify for a tree's signature by owning that tree's **keystone** (class-mod boosts count toward ownership). You may qualify in several trees, but you field **one active signature** at a time — your selection is changeable, including at respec.

All four share **one charge pool, 0–100**. Charge builds only from resolved play: a boss attempt that does not fire grants **34**, an endless encounter that does not fire grants **20**, and a Fixer-selected hunter also gains **3 per craft unit completed** and **0.2 per repair condition point restored**. The resolution that fires grants no charge. Ending an endless run — any ending — resets the pool to 0; boss charge otherwise persists until spent. Action skills never fire while roaming.

- **Deadeye Salvo** (Gunslinger) — a single burst dealing damage equal to **12% of the target's maximum health**. Because the fight ends sooner, the boss also deals less damage over it.
- **Saturation Strike** (Demolition) — flat damage equal to **7% of the target's maximum health**, plus break damage equal to **35% of the target's shield and 35% of its armor**, and a stagger window covering half the fight during which the boss's damage is cut by **30%**.
- **Cache Surge** (Scavenger) — on victory, **2 extra drop rolls** through the normal drop pipeline, with Epic rarity weight multiplied by **1.5×** and Legendary weight by **2×** on those rolls. It never touches the boss's dedicated-drop roll.
- **Overclock** (Fixer) — two fires, one pool. In combat, your prepared consumables are read at **quality ×1.25** for that attempt. At the Workshop, firing instantly completes the in-progress unit on every active bench — same outputs, same quality roll, same XP. It buys time, never output.

## Fights are modeled, not brawled

Boss and endless fights are resolved as a **30-second model** of your loadout against the target — your DPS chain, shield break and armor break, survival pool, prepared consumables, chosen risk setting, and action skill all priced in at once. There is no twitch play and no mid-fight input: every decision that matters happens at prep, in your loadout, your belt, and your build. That is why the prep screen shows you the target in full — see [[Bosses]].

---

_Source of truth: `src/lib/stats/dpsChain.ts`, `src/lib/combat/shieldBehaviors.ts`, `src/lib/combat/damageContract.ts`, `src/content/actionSkills.ts`, `src/lib/mechanics/buildCharacterMechanicsSnapshot.ts`, `src/lib/simulation/bossSimulator.ts`, `src/server/gameplay/serverLoadout.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
