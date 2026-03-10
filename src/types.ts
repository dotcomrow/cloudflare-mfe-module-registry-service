export type PublishChannel = "preview" | "prod";

export interface Env {
  REGISTRY_DB: D1Database;
  ENVIRONMENT?: string;
  SERVICE_TITLE?: string;
  GOOGLE_AUTH_ENABLED?: string;
  GOOGLE_AUTH_ALLOWED_AUDIENCES?: string;
  GOOGLE_AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_AUTH_ALLOWED_DOMAINS?: string;
  GOOGLE_AUTH_ALLOWED_GROUPS?: string;
  GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_AUTH_GROUPS_IMPERSONATED_USER?: string;
  GOOGLE_AUTH_GROUPS_CACHE_TTL_SECONDS?: string;
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
