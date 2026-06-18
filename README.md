# cloudflare-mfe-module-registry-service

Cloudflare Worker + D1 service for MFE catalog management.

## What It Provides

- Public registry UI (`/`) for browsing published MFEs.
- Public read APIs for module list/details.
- Authenticated publish API (`POST /v1/modules/publish`) for CI publishers.
- Authenticated promotion API (`POST /v1/modules/promote`) to copy an existing version from one channel to the other.
- Auth app registry APIs for auth-gateway slug/base URL management and k8s sync.
- Idempotent publish handling (`x-idempotency-key`) to make retries safe.
- Storage of module metadata, versions, integration info, parameter info, and optional screenshots metadata.
- Strict, configurable publish validation to block incomplete module metadata.

## API Endpoints

- `GET /healthz`
- `GET /api/modules?channel=all|preview|prod&q=<search>&limit=100&offset=0`
- `GET /api/modules/:module_key`
- `GET /api/modules/:module_key/:module_version?channel=preview|prod`
- `GET /api/auth/apps?enabled=all|enabled|disabled&limit=500&offset=0` (optional bearer token via `AUTH_APPS_READ_TOKEN`)
- `GET /api/auth/apps/:slug` (optional bearer token via `AUTH_APPS_READ_TOKEN`)
- `POST /v1/auth/apps/upsert` (Google-auth protected)
- `POST /v1/modules/publish` (Google-auth protected, supports JSON metadata or multipart file upload)
- `POST /v1/modules/promote` (Google-auth protected, promotes an existing published version to another channel)

Directus integration uses:

- `GET /api/modules` to populate module choices in the editor.
- `GET /api/modules/:module_key` to resolve module definition/seed metadata for props rendering.

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

### Auth App Registry

Use this to store auth-gateway app registrations (`slug`, `display_name`, `base_url`, `base_urls`, `enabled`) in D1 as source-of-truth.

Example upsert:

```bash
curl -X POST "https://<host>/v1/auth/apps/upsert" \
  -H "Authorization: Bearer <google-or-keycloak-token>" \
  -H "Content-Type: application/json" \
  --data '{
    "slug": "internal-prod",
    "display_name": "Internal Production",
    "base_url": "https://internal.suncoast.systems",
    "base_urls": ["https://internal.suncoast.systems"],
    "enabled": true,
    "module_key": "mfe-internal-app-shell"
  }'
```

If `AUTH_APPS_READ_TOKEN` is set, callers to `GET /api/auth/apps*` must send `Authorization: Bearer <AUTH_APPS_READ_TOKEN>`.

### Publish With Direct File Upload

`POST /v1/modules/publish` also supports `multipart/form-data` and can upload:

- `bundle_file` (JavaScript bundle)
- `manifest_file` (publish manifest JSON)

When files are sent, the API uploads them to R2 (`REGISTRY_ASSETS`) and automatically sets `bundle_url` / `manifest_url` before storing publish metadata.
By default, uploaded asset URLs are served from the same Worker origin at `/assets/<object-key>`.

Required multipart text fields:

- `module_key`
- `module_version`
- `channel` (`preview` or `prod`)

Optional text fields:

- `published_at`, `provider`, `component_type`
- `release`, `definition`, `seed`, `checksums` (JSON strings)

Example:

```bash
curl -X POST "https://<host>/v1/modules/publish" \
  -H "Authorization: Bearer <google-or-keycloak-token>" \
  -H "x-idempotency-key: <unique-key>" \
  -F "module_key=mfe-example-chat" \
  -F "module_version=v1.0.1" \
  -F "channel=preview" \
  -F "bundle_file=@./dist/example-mfe.js;type=application/javascript" \
  -F "manifest_file=@./dist/module.publish.json;type=application/json"
```

### Promote Existing Version To Another Channel

Use this when you want the same `module_key` + `module_version` available in both `preview` and `prod` without rebuilding or re-uploading artifacts.

```bash
curl -X POST "https://<host>/v1/modules/promote" \
  -H "Authorization: Bearer <google-or-keycloak-token>" \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: <unique-key>" \
  --data '{
    "module_key": "mfe-example-chat",
    "module_version": "sha-deaaa3b9a404",
    "source_channel": "prod",
    "target_channel": "preview"
  }'
```

## Authentication For Publish API

Publish auth is enabled by default.

Set these in Wrangler env vars:

- `GOOGLE_AUTH_ENABLED` (`true` by default)
- `GOOGLE_AUTH_ALLOWED_AUDIENCE` (preferred single audience value; use same value in preview and production)
- `GOOGLE_AUTH_ALLOWED_AUDIENCES` (legacy CSV fallback; used only when `GOOGLE_AUTH_ALLOWED_AUDIENCE` is empty)
- `GOOGLE_AUTH_ALLOWED_EMAILS` (optional comma-separated allow-list)
- `GOOGLE_AUTH_ALLOWED_DOMAINS` (optional comma-separated email domains)

If both `GOOGLE_AUTH_ALLOWED_EMAILS` and `GOOGLE_AUTH_ALLOWED_DOMAINS` are empty, token audience validation is the main gate.

### Keycloak Auth (optional)

Enable Keycloak auth by setting `KEYCLOAK_AUTH_ENABLED=true`. If `KEYCLOAK_AUTH_ISSUER` is not set, the token `iss` claim is used as the issuer and `KEYCLOAK_AUTH_USERINFO_URL` defaults from it:

- `KEYCLOAK_AUTH_ENABLED` (`false` by default)
- `KEYCLOAK_AUTH_ISSUER` (optional, token `iss` fallback when omitted)
- `KEYCLOAK_AUTH_USERINFO_URL` (optional override; defaults to `<issuer>/protocol/openid-connect/userinfo`)
- `KEYCLOAK_AUTH_USERINFO_TIMEOUT_MS` (optional request timeout in ms for userinfo calls, default `8000`)
- `KEYCLOAK_AUTH_REQUIRED_ROLE` (`mfe-registry-access`)
- `KEYCLOAK_AUTH_AUDIENCE` (optional audience check)

For Keycloak access token authentication, the token must include `mfe-registry-access` in `suncoast_roles`, `realm_access.roles`, or one `resource_access.*.roles` claim to publish/promote.

For CI-only publish with a Google service account key, prefer:

- `GOOGLE_AUTH_ALLOWED_EMAILS` set to the exact service account email used by CI
- `GOOGLE_AUTH_ALLOWED_AUDIENCE` set to your registry URL audience

## Publish Validation Gates

Publish API validation defaults to strict mode and can be tuned with env vars:

- `PUBLISH_VALIDATION_STRICT` (`true` default)
- `PUBLISH_VALIDATION_REQUIRE_PROPS_SCHEMA` (defaults to strict mode value)
- `PUBLISH_VALIDATION_REQUIRE_DEFAULT_PROPS` (defaults to strict mode value)
- `PUBLISH_VALIDATION_VALIDATE_MANIFEST` (defaults to strict mode value)
- `PUBLISH_VALIDATION_VERIFY_ASSET_URLS` (`false` default; when enabled verifies remote `bundle_url` and `manifest_url` reachability)
- `PUBLISH_VALIDATION_TIMEOUT_MS` (`8000` default; clamped to `1000..30000`)

When strict validation is enabled, publish requires complete definition/seed metadata suitable for Directus rendering and rejects mismatches (for example payload `module_key` vs metadata `module_key`).

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
   - `prod` -> workspace `<repo>` -> `deployment_environment=production`, `manage_d1_resources=true`, `manage_r2_resources=true`
   - `dev` -> workspace `<repo>-preview` -> `deployment_environment=preview`, `manage_d1_resources=false`, `manage_r2_resources=true`
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
- Optional shared audience variable (repo or org): `MODULE_REGISTRY_SERVICE_GOOGLE_TOKEN_AUDIENCE`
  - Used by deployment workflows to set one `google_auth_allowed_audience` value for both preview and production.
  - Default fallback (when unset): `https://cloudflare-mfe-module-registry-service.suncoast.systems/`

Set these Terraform variables in each workspace (sensitive where noted):

- `cloudflare_token` (sensitive)
- `cloudflare_account_id`
- `project_name` (defaults to repo name when created by `initial-deploy.yml`)
- `org_name` (defaults to repo owner when created by `initial-deploy.yml`)

Optional Terraform variables:

- `cloudflare_zone_id` (required only when `manage_worker_domains=true` or `manage_worker_routes=true`)
- `domain`, `worker_service_name_production`, `worker_service_name_preview`, `worker_preview_hostname`
- `manage_worker_domains`, `manage_worker_routes`
- `manage_r2_resources`, `r2_dev_assets_bucket_name`, `r2_prod_assets_bucket_name`
- `worker_production_route_pattern`, `worker_preview_route_pattern`
- `google_auth_allowed_audience` (preferred shared value for both preview/prod)
- `google_auth_allowed_audiences` (legacy fallback CSV)
- `google_auth_allowed_emails`, `google_auth_allowed_domains`
- `auth_apps_read_token` (optional bearer token required by auth app read endpoints)
- `publish_uploads_enabled`
- `publish_uploads_public_base_url_preview`, `publish_uploads_public_base_url_production` (optional URL overrides)
- `publish_uploads_r2_prefix`
- `publish_uploads_max_bundle_bytes`, `publish_uploads_max_manifest_bytes`
- `publish_validation_strict`
- `publish_validation_require_props_schema`, `publish_validation_require_default_props`
- `publish_validation_validate_manifest`, `publish_validation_verify_asset_urls`
- `publish_validation_timeout_ms`

If base URL overrides are not provided, uploads automatically use `<worker-origin>/assets/...`.

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
