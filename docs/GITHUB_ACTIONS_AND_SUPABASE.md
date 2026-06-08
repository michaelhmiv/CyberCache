# GitHub Actions and Supabase Setup

This repo has two GitHub Actions workflows:

- `.github/workflows/ci.yml` for tests, mechanics checks, build, and lint.
- `.github/workflows/supabase-migrations.yml` for applying committed Supabase migrations after merge to `master` or by manual dispatch.

## Required GitHub Secrets

Add these in GitHub repository settings:

- `SB_TOKEN`
- `SB_PROJECT_REF`
- `SB_DB_PASS`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

For the current CyberCache project:

- `SB_PROJECT_REF` should be `dyrmcwutjdzontjawqii`
- `VITE_SUPABASE_URL` should be `https://dyrmcwutjdzontjawqii.supabase.co`
- use the active publishable key from Supabase for `VITE_SUPABASE_ANON_KEY`

Do not commit secret values.

## Migration Workflow Behavior

The migration workflow:

1. Runs on pushes to `master` when `supabase/migrations/**` changes.
2. Also supports manual `workflow_dispatch`.
3. Checks out the repo.
4. Installs the Supabase CLI using `supabase/setup-cli@v1`.
5. Exports the Supabase CLI environment variables from GitHub Secrets.
6. Links the CyberCache Supabase project.
7. Applies pending migrations.

## Manual Migration Application

You can also apply migrations locally with Supabase CLI:

```bash
supabase login
supabase link --project-ref dyrmcwutjdzontjawqii
supabase db push
```

Then verify tables exist in Supabase.

## Why This Is Separate From CI

CI should run on every PR. Database migrations should run only after merge to `master` or by manual dispatch. That prevents PR branches from mutating the shared development database.
