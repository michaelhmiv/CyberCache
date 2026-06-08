# Supabase Runtime Setup

CyberCache static gameplay content lives in `src/content`. Supabase should store only mutable player/runtime state.

## Environment Variables

Create a local `.env` file with:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Do not commit `.env` or secret keys.

## Dependency Note

This PR intentionally adds only a config helper and documentation. It does not add `@supabase/supabase-js` because the lockfile should be updated by the agent that can run package installation locally.

When wiring the client, install:

```bash
npm install @supabase/supabase-js
```

Then create a typed client using the config helper in `src/lib/supabase/config.ts`.

## Migration

The migration introduced in the Phase 1 PR creates the initial runtime tables for:

- profiles
- item instances
- profession progress
- active action state
- market listings
- held service payments/items
- service jobs

Apply it only after reviewing the table names and row-level security policies.

## Source-of-Truth Split

Static GitHub content:

- loot tables
- rarity rules
- XP rewards
- recipe definitions
- profession definitions
- starter store rules
- vehicle classes

Supabase runtime data:

- generated item instances
- player inventory
- player XP and profile
- profession XP
- active action state
- market listings
- service jobs
- transaction-like records

## Recommended Next Step

After the migration is accepted, generate database types locally and compare them against `src/content/runtimeModel.ts` before wiring live client calls.
