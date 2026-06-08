# GitHub Actions and Supabase Setup

This repo now has a CI workflow in `.github/workflows/ci.yml` for tests, mechanics checks, build, and lint.

The Supabase migration workflow still needs to be added manually by a local agent or maintainer because it requires repository secrets and CLI deployment credentials.

## Required GitHub Secrets

Add these in GitHub repository settings:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

For the current CyberCache project:

- `SUPABASE_PROJECT_REF` should be `dyrmcwutjdzontjawqii`
- `VITE_SUPABASE_URL` should be `https://dyrmcwutjdzontjawqii.supabase.co`
- use the active publishable key from Supabase for `VITE_SUPABASE_ANON_KEY`

Do not commit secret values.

## Manual Migration Application

Until the workflow is added, apply migrations locally with Supabase CLI:

```bash
supabase login
supabase link --project-ref dyrmcwutjdzontjawqii
supabase db push
```

Then verify tables exist in Supabase.

## Migration Workflow To Add

Create `.github/workflows/supabase-migrations.yml` locally with a workflow that:

1. Runs on pushes to `master` when `supabase/migrations/**` changes.
2. Also supports `workflow_dispatch`.
3. Checks out the repo.
4. Installs the Supabase CLI using `supabase/setup-cli@v1`.
5. Links the project using the project ref secret.
6. Runs the database push command.

Keep all credentials in GitHub Secrets.

## Why This Is Separate From CI

CI should run on every PR. Database migrations should run only after merge to `master` or by manual dispatch. That prevents PR branches from mutating the shared development database.
