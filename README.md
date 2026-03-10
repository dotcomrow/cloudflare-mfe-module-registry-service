# cloudflare-mfe-module-registry-service

Cloudflare Worker + D1 service for MFE catalog management.

## What It Provides

- Public registry UI (`/`) for browsing published MFEs.
- Public read APIs for module list/details.
- Authenticated publish API (`POST /v1/modules/publish`) for CI publishers.
- Idempotent publish handling (`x-idempotency-key`) to make retries safe.
- Storage of module metadata, versions, integration info, parameter info, and optional screenshots metadata.

## API Endpoints

- `GET /healthz`
- `GET /api/modules?channel=all|preview|prod&q=<search>&limit=100&offset=0`
- `GET /api/modules/:module_key`
- `GET /api/modules/:module_key/:module_version?channel=preview|prod`
- `POST /v1/modules/publish` (Google-auth protected)

`POST /v1/modules/publish` accepts the payload emitted by `example-mfe/scripts/notify-catalog-service.mjs`:

```json
{
  "module_key": "mfe-example-chat",
  "module_version": "v1.0.0",
  "channel": "preview",
  "published_at": "2026-03-09T23:55:00.000Z",
  "provider": "suncoast",
  "component_type": "widget",
  "bundle_url": "https://cdn.example/mfe/mfe-example-chat/v1.0.0/example-mfe.js",
  "manifest_url": "https://cdn.example/mfe/mfe-example-chat/v1.0.0/module.publish.json",
  "release": {},
  "definition": {
    "url": "https://cdn.example/mfe/mfe-example-chat/v1.0.0/module.definition.json"
  },
  "seed": {
    "url": "https://cdn.example/mfe/mfe-example-chat/v1.0.0/cms-module.seed.json"
  },
  "checksums": {
    "bundle_sha256": "..."
  }
}
```

The service fetches `definition.url` and `seed.url` (if present) to enrich catalog metadata.

## Google Auth For Publish API

Publish auth is enabled by default.

Set these in Wrangler env vars:

- `GOOGLE_AUTH_ENABLED` (`true` by default)
- `GOOGLE_AUTH_ALLOWED_AUDIENCES` (comma-separated Google client IDs)
- `GOOGLE_AUTH_ALLOWED_EMAILS` (optional comma-separated allow-list)
- `GOOGLE_AUTH_ALLOWED_DOMAINS` (optional comma-separated email domains)
- `GOOGLE_AUTH_ALLOWED_GROUPS` (optional comma-separated Google Group emails)
- `GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_EMAIL` (required when `GOOGLE_AUTH_ALLOWED_GROUPS` is set)
- `GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_PRIVATE_KEY` (required when `GOOGLE_AUTH_ALLOWED_GROUPS` is set)
- `GOOGLE_AUTH_GROUPS_IMPERSONATED_USER` (required when `GOOGLE_AUTH_ALLOWED_GROUPS` is set)
- `GOOGLE_AUTH_GROUPS_CACHE_TTL_SECONDS` (optional, default `300`, max `3600`)

If both `GOOGLE_AUTH_ALLOWED_EMAILS` and `GOOGLE_AUTH_ALLOWED_DOMAINS` are empty, token audience validation is the main gate.

When `GOOGLE_AUTH_ALLOWED_GROUPS` is set, publish access additionally requires membership in at least one configured Google Group.

## Google Group Setup (Workspace)

To enforce group membership, configure Google Workspace:

1. Create a service account in Google Cloud.
2. Enable domain-wide delegation for that service account.
3. In Google Workspace Admin, authorize this OAuth scope for the service account client:
   - `https://www.googleapis.com/auth/admin.directory.group.member.readonly`
4. Set `GOOGLE_AUTH_GROUPS_IMPERSONATED_USER` to an admin user that can read group memberships.
5. Add publisher users to your selected Google Group(s), then set those group emails in `GOOGLE_AUTH_ALLOWED_GROUPS`.

## Local Development

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open:

- `http://127.0.0.1:8787/`

## Deployment Model

Deployments are Terraform-first and run through GitHub Actions.

1. `.github/workflows/initial-deploy.yml` bootstraps Terraform Cloud workspaces (`<repo>` and `<repo>-preview`), uploads `terraform/`, creates the first apply run, then disables itself.
2. `.github/workflows/terraform-deploy.yml` runs on branch pushes:
   - `prod` -> workspace `<repo>` -> `deployment_environment=production` and `manage_d1_resources=true`
   - `dev` -> workspace `<repo>-preview` -> `deployment_environment=preview` and `manage_d1_resources=false`
3. The workflow bundles Worker code with `wrangler deploy --dry-run` into `terraform/worker-build/index.js`, then Terraform deploys:
   - `cloudflare_worker`
   - `cloudflare_worker_version`
   - `cloudflare_workers_deployment`
   - `cloudflare_d1_database` (in production workspace only)
   - optional `cloudflare_workers_custom_domain` and `cloudflare_workers_route`

Optional GitHub Repository Variables can override workspace names:

- `TFC_WORKSPACE_PRODUCTION`
- `TFC_WORKSPACE_PREVIEW`

## Terraform Cloud Configuration

GitHub configuration:

- Repository secret: `TFE_TOKEN`
- Repository variable: `TFE_PROJECT` (Terraform Cloud project name)

Set these Terraform variables in each workspace (sensitive where noted):

- `cloudflare_token` (sensitive)
- `cloudflare_account_id`
- `project_name` (defaults to repo name when created by `initial-deploy.yml`)
- `org_name` (defaults to repo owner when created by `initial-deploy.yml`)

Optional Terraform variables:

- `cloudflare_zone_id` (required only when `manage_worker_domains=true` or `manage_worker_routes=true`)
- `domain`, `worker_service_name_production`, `worker_service_name_preview`, `worker_preview_hostname`
- `manage_worker_domains`, `manage_worker_routes`
- `worker_production_route_pattern`, `worker_preview_route_pattern`
- `google_auth_allowed_audiences`, `google_auth_allowed_emails`, `google_auth_allowed_domains`
- `google_auth_allowed_groups`
- `google_auth_groups_service_account_email`
- `google_auth_groups_service_account_private_key` (sensitive)
- `google_auth_groups_impersonated_user`
- `google_auth_groups_cache_ttl_seconds`

## Wrangler Deploy (Optional)

Manual Wrangler deploy is still available for ad-hoc deployments:

```bash
npm run deploy:preview
npm run deploy:production
```

## D1 Migrations

The Worker now auto-bootstraps the base schema (`modules`, `module_versions`, `publish_events`) on first DB access using idempotent `CREATE ... IF NOT EXISTS` statements.

Manual migration commands remain available and are useful when you add future schema changes:

```bash
npm run db:migrate:preview
npm run db:migrate:production
```

## D1 Schema

Initial schema is in:

- `migrations/0001_init.sql`

Tables:

- `modules`
- `module_versions`
- `publish_events`
