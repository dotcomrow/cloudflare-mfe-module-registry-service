export type PublishChannel = "preview" | "prod";

export interface Env {
  REGISTRY_DB: D1Database;
  REGISTRY_ASSETS: R2Bucket;
  ENVIRONMENT?: string;
  SERVICE_TITLE?: string;
  AUTH_APPS_READ_TOKEN?: string;
  GOOGLE_AUTH_ENABLED?: string;
  GOOGLE_AUTH_ALLOWED_AUDIENCE?: string;
  GOOGLE_AUTH_ALLOWED_AUDIENCES?: string;
  GOOGLE_AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_AUTH_ALLOWED_DOMAINS?: string;
  KEYCLOAK_AUTH_ENABLED?: string;
  KEYCLOAK_AUTH_ISSUER?: string;
  KEYCLOAK_AUTH_USERINFO_URL?: string;
  KEYCLOAK_AUTH_USERINFO_TIMEOUT_MS?: string;
  KEYCLOAK_AUTH_REQUIRED_ROLE?: string;
  KEYCLOAK_AUTH_AUDIENCE?: string;
  PUBLISH_UPLOADS_ENABLED?: string;
  PUBLISH_UPLOADS_PUBLIC_BASE_URL?: string;
  PUBLISH_UPLOADS_R2_PREFIX?: string;
  PUBLISH_UPLOADS_MAX_BUNDLE_BYTES?: string;
  PUBLISH_UPLOADS_MAX_MANIFEST_BYTES?: string;
  PUBLISH_VALIDATION_STRICT?: string;
  PUBLISH_VALIDATION_REQUIRE_PROPS_SCHEMA?: string;
  PUBLISH_VALIDATION_REQUIRE_DEFAULT_PROPS?: string;
  PUBLISH_VALIDATION_VERIFY_ASSET_URLS?: string;
  PUBLISH_VALIDATION_VALIDATE_MANIFEST?: string;
  PUBLISH_VALIDATION_TIMEOUT_MS?: string;
  MODULE_VERSION_RETENTION_LIMIT?: string;
}

export interface PublishPayload {
  module_key: string;
  module_version: string;
  channel: PublishChannel;
  published_at?: string;
  provider?: string;
  component_type?: string;
  bundle_url: string;
  manifest_url: string;
  release?: Record<string, unknown>;
  definition?: Record<string, unknown>;
  seed?: Record<string, unknown>;
  checksums?: Record<string, unknown>;
}

export interface AuthGatewayAppUpsertPayload {
  slug: string;
  display_name: string;
  base_url: string;
  base_urls: string[];
  enabled: boolean;
  module_key?: string;
}

export interface AuthGatewayAppRecord {
  slug: string;
  display_name: string;
  base_url: string;
  base_urls: string[];
  enabled: boolean;
  module_key: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthPrincipal {
  subject: string;
  email: string | null;
  issuer: string;
  audience: string | null;
}

export interface ModuleSummary {
  module_key: string;
  provider: string | null;
  component_type: string | null;
  latest_version_preview: string | null;
  latest_version_prod: string | null;
  latest_published_at_preview: string | null;
  latest_published_at_prod: string | null;
  versions_total: number;
  updated_at: string;
}

export interface ModuleVersionRecord {
  module_key: string;
  module_version: string;
  channel: PublishChannel;
  bundle_url: string;
  manifest_url: string;
  published_at: string | null;
  provider: string | null;
  component_type: string | null;
  release: Record<string, unknown>;
  definition_ref: Record<string, unknown>;
  seed_ref: Record<string, unknown>;
  definition: Record<string, unknown>;
  seed: Record<string, unknown>;
  checksums: Record<string, unknown>;
  screenshots: unknown[];
  integrations: unknown;
  parameters: unknown;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
