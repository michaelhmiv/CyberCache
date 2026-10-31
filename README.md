# CyberCache

**Mobile-first idle roguelite looter RPG.** Roam seven zones, farm procedurally generated weapons, build a seven-slot loadout, take down bosses in a four-phase simulation, craft in the Workshop, and trade on a server-authoritative marketplace — all wrapped in pixel art with a loot moment that treats a legendary drop like it matters.

Currently in **closed testing on Google Play** (Android). The server runs on Railway.

## Gameplay

- **Idle roaming** — your hunter farms zones in real time and keeps earning while you're away (offline settlement with a configurable cap). Roaming income accrues fractionally and banks to the fraction of a credit — see `MECHANICS.md`.
- **Deep weapon system** — 6 weapon types × 6 manufacturers × 6 elements × 5 rarities. The generator rolls exactly 6 part slots per weapon, plus procedural affixes. **25 legendaries**, each with a bespoke pixel sprite and a real, implemented effect (the full honesty table lives in `MECHANICS.md` §11).
- **7 gear slots** — Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic.
- **Boss combat** — 4-phase simulation (Survival → Break → DPS → Mechanics) against 13 bosses, with risk settings, elemental matchups, consumable planning, and per-boss signature mechanics.
- **Skill trees** — Gunslinger, Demolition, Scavenger; bonuses feed the same economy and simulation the server runs.
- **Economy** — Credits, Scrap, Cache Keys and fragments, 10 crafting materials, a vendor, a Workshop with a crafting queue, and a marketplace where listings are real (player-posted, NPC-seeded) and every transaction settles on the server.
- **Accounts** — start playing instantly as a guest; link **Sign in with Google** later and keep the same account. Progress lives server-side per account.

## Architecture

CyberCache is **server-authoritative**. The game server — the **Chef** (Express + Postgres) — owns all economy truth: drops, claims, crafting, market settlement, and boss verification are computed or verified there, never trusted from the client.

- `docs/ARCHITECTURE.md` — the shape of the system
- `MECHANICS.md` — the game-design source of truth (rates, rarities, legendary effects)
- `docs/railway.md` — deployment and operations runbook
- `AGENTS.md` — **read this before contributing code**; it defines the boundaries and the mandatory completion gate

Art direction is **pixel art**: sprites are generated, chroma-keyed, and anchored through an in-repo pipeline (`src/assets/pixel/manifest.json`), weapons are assembled by a deterministic parts compositor, and boss pacing follows a fixed motion language. Loot drops are rarity-scaled — a legendary dims the world and rises on a beam with its full item card.

## Tech stack

- **Client** — React 19 + TypeScript, Vite, Tailwind CSS 4, Zustand, Framer Motion; Capacitor for Android
- **Server** — Node + Express, Postgres (the Chef), HS256 JWT sessions with rotating refresh tokens
- **Hosting** — Railway (Chef + Postgres + scheduled job services)
- **CI** — GitHub Actions: full test/build/lint gate, Android build + emulator smoke tests, gitleaks

## Quick start

```bash
npm install
npm run dev        # client on http://localhost:5173
```

Designed for a 480×800 mobile viewport. The Chef mounts its game routes only when `CHEF_JWT_SECRET` and `DATABASE_URL` are set — see `docs/railway.md` for the full environment list and the migration sequence (`db/migrations/`).

## Completion gate

Every change must pass, per `AGENTS.md`:

```bash
npm test
npm run build
npm run lint
bash scripts/guard-architecture.sh
npx tsc --noEmit
```

## License

AGPL-3.0 — see `LICENSE`.
