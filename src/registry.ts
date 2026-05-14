import type {
  AuthPrincipal,
  ModuleSummary,
  ModuleVersionRecord,
  PublishChannel,
  PublishPayload,
} from "./types";
import { HttpError, asNonEmptyString, hashHexFromText, isRecord, nowIso, safeParseJson } from "./util";

const MODULE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const REGISTRY_SCHEMA_STATEMENTS: string[] = [
  "CREATE TABLE IF NOT EXISTS modules (module_key TEXT PRIMARY KEY, provider TEXT, component_type TEXT, latest_version_preview TEXT, latest_version_prod TEXT, latest_published_at_preview TEXT, latest_published_at_prod TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS module_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, module_key TEXT NOT NULL, module_version TEXT NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('preview', 'prod')), bundle_url TEXT NOT NULL, manifest_url TEXT NOT NULL, published_at TEXT, provider TEXT, component_type TEXT, release_json TEXT NOT NULL, definition_ref_json TEXT NOT NULL, seed_ref_json TEXT NOT NULL, definition_json TEXT NOT NULL, seed_json TEXT NOT NULL, checksums_json TEXT NOT NULL, source_payload_json TEXT NOT NULL, screenshots_json TEXT NOT NULL, integrations_json TEXT NOT NULL, parameters_json TEXT NOT NULL, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(module_key, module_version, channel))",
  "CREATE INDEX IF NOT EXISTS idx_module_versions_module_key ON module_versions(module_key)",
  "CREATE INDEX IF NOT EXISTS idx_module_versions_channel ON module_versions(channel)",
  "CREATE INDEX IF NOT EXISTS idx_module_versions_published_at ON module_versions(published_at DESC)",
  "CREATE TABLE IF NOT EXISTS publish_events (id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE, module_key TEXT NOT NULL, module_version TEXT NOT NULL, channel TEXT NOT NULL, request_hash TEXT NOT NULL, principal TEXT, response_json TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_publish_events_module ON publish_events(module_key, module_version, channel)",
];

let registrySchemaReady = false;
let registrySchemaInitPromise: Promise<void> | null = null;

interface PublishRow {
  response_json: string;
}

interface ModuleRow {
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

interface ModuleVersionRow {
  module_key: string;
  module_version: string;
  channel: PublishChannel;
  bundle_url: string;
  manifest_url: string;
  published_at: string | null;
  provider: string | null;
  component_type: string | null;
  release_json: string;
  definition_ref_json: string;
  seed_ref_json: string;
  definition_json: string;
  seed_json: string;
  checksums_json: string;
  screenshots_json: string;
  integrations_json: string;
  parameters_json: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishValidationOptions {
  strictMode?: boolean;
  requirePropsSchema?: boolean;
  requireDefaultProps?: boolean;
  verifyAssetUrls?: boolean;
  validateManifestDocument?: boolean;
  remoteFetchTimeoutMs?: number;
  manifestDocument?: Record<string, unknown> | null;
}

interface ResolvedPublishValidationOptions {
  strictMode: boolean;
  requirePropsSchema: boolean;
  requireDefaultProps: boolean;
  verifyAssetUrls: boolean;
  validateManifestDocument: boolean;
  remoteFetchTimeoutMs: number;
}

interface JsonFetchOptions {
  fieldName: string;
  required: boolean;
  timeoutMs: number;
}

const DEFAULT_VALIDATION_TIMEOUT_MS = 8000;
const MIN_VALIDATION_TIMEOUT_MS = 1000;
const MAX_VALIDATION_TIMEOUT_MS = 30000;

function clampTimeoutMs(rawValue: number | undefined): number {
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_VALIDATION_TIMEOUT_MS;
  }
  const normalized = Math.round(rawValue as number);
  return Math.max(MIN_VALIDATION_TIMEOUT_MS, Math.min(MAX_VALIDATION_TIMEOUT_MS, normalized));
}

function resolvePublishValidationOptions(options?: PublishValidationOptions): ResolvedPublishValidationOptions {
  const strictMode = options?.strictMode ?? true;
  return {
    strictMode,
    requirePropsSchema: options?.requirePropsSchema ?? strictMode,
    requireDefaultProps: options?.requireDefaultProps ?? strictMode,
    verifyAssetUrls: options?.verifyAssetUrls ?? false,
    validateManifestDocument: options?.validateManifestDocument ?? strictMode,
    remoteFetchTimeoutMs: clampTimeoutMs(options?.remoteFetchTimeoutMs),
  };
}

function formatErrorCause(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("publish_validation_timeout"), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseChannel(input: unknown): PublishChannel {
  const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (normalized === "preview" || normalized === "prod") {
    return normalized;
  }
  throw new HttpError(400, "Invalid channel. Expected 'preview' or 'prod'.");
}

function validateUrl(urlValue: unknown, fieldName: string): string {
  const url = asNonEmptyString(urlValue);
  if (!url) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  try {
    const parsed = new URL(url);
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      throw new Error("unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new HttpError(400, `${fieldName} must be a valid http(s) URL.`);
  }
}

function validateModuleKey(value: unknown): string {
  const moduleKey = asNonEmptyString(value);
  if (!moduleKey) {
    throw new HttpError(400, "module_key is required.");
  }
  if (!MODULE_KEY_PATTERN.test(moduleKey)) {
    throw new HttpError(400, "module_key has invalid format.", {
      expected_pattern: MODULE_KEY_PATTERN.source,
    });
  }
  return moduleKey;
}

function validateModuleVersion(value: unknown): string {
  const moduleVersion = asNonEmptyString(value);
  if (!moduleVersion) {
    throw new HttpError(400, "module_version is required.");
  }
  if (moduleVersion.length > 128) {
    throw new HttpError(400, "module_version is too long.");
  }
  return moduleVersion;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return value;
}

export function validatePublishPayload(raw: unknown): PublishPayload {
  if (!isRecord(raw)) {
    throw new HttpError(400, "Publish payload must be an object.");
  }

  const module_key = validateModuleKey(raw.module_key);
  const module_version = validateModuleVersion(raw.module_version);
  const channel = parseChannel(raw.channel);
  const bundle_url = validateUrl(raw.bundle_url, "bundle_url");
  const manifest_url = validateUrl(raw.manifest_url, "manifest_url");
  const published_at = asNonEmptyString(raw.published_at) ?? undefined;
  const provider = asNonEmptyString(raw.provider) ?? undefined;
  const component_type = asNonEmptyString(raw.component_type) ?? undefined;

  return {
    module_key,
    module_version,
    channel,
    bundle_url,
    manifest_url,
    published_at,
    provider,
    component_type,
    release: normalizeRecord(raw.release),
    definition: normalizeRecord(raw.definition),
    seed: normalizeRecord(raw.seed),
    checksums: normalizeRecord(raw.checksums),
  };
}

async function fetchJsonDocument(
  url: string | null,
  fallback: Record<string, unknown>,
  options: JsonFetchOptions,
): Promise<Record<string, unknown>> {
  if (!url) {
    if (options.required) {
      throw new HttpError(400, `Publish validation failed: ${options.fieldName} document URL is required.`);
    }
    return fallback;
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
      options.timeoutMs,
    );

    if (!response.ok) {
      if (options.required) {
        throw new HttpError(400, `Publish validation failed: unable to fetch ${options.fieldName} document.`, {
          url,
          status: response.status,
          status_text: response.statusText,
        });
      }
      return fallback;
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (isRecord(payload)) {
      return payload;
    }

    if (options.required) {
      throw new HttpError(400, `Publish validation failed: ${options.fieldName} document must be a JSON object.`, {
        url,
      });
    }

    return fallback;
  } catch (error) {
    if (options.required) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(400, `Publish validation failed: unable to fetch ${options.fieldName} document.`, {
        url,
        cause: formatErrorCause(error),
      });
    }
    return fallback;
  }
}

function pickFirstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (isRecord(value)) {
      return value;
    }
  }
  return null;
}

function hasAnyKeys(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

function collectNonEmptyStrings(...values: unknown[]): string[] {
  return uniqueArray(
    values
      .map((value) => asNonEmptyString(value))
      .filter((value): value is string => typeof value === "string"),
  );
}

function resolvePropsSchemaCandidate(
  definition: Record<string, unknown>,
  seed: Record<string, unknown>,
): Record<string, unknown> | null {
  const definitionIo = isRecord(definition.io) ? definition.io : {};
  const seedIo = isRecord(seed.io) ? seed.io : {};

  return pickFirstRecord(
    definition.props_schema,
    definition.propsSchema,
    definition.schema,
    definition.config_schema,
    definition.configSchema,
    definitionIo.props_schema,
    definitionIo.propsSchema,
    definitionIo.schema,
    definitionIo.config_schema,
    definitionIo.configSchema,
    seed.props_schema,
    seed.propsSchema,
    seed.schema,
    seed.config_schema,
    seed.configSchema,
    seedIo.props_schema,
    seedIo.propsSchema,
    seedIo.schema,
    seedIo.config_schema,
    seedIo.configSchema,
  );
}

function resolveDefaultPropsCandidate(
  definition: Record<string, unknown>,
  seed: Record<string, unknown>,
): Record<string, unknown> | null {
  const definitionIo = isRecord(definition.io) ? definition.io : {};
  const seedIo = isRecord(seed.io) ? seed.io : {};

  return pickFirstRecord(
    seed.default_props,
    seed.defaultProps,
    seed.defaults,
    seed.props_defaults,
    seedIo.default_props,
    seedIo.defaultProps,
    seedIo.defaults,
    seedIo.props_defaults,
    definition.default_props,
    definition.defaultProps,
    definition.defaults,
    definition.props_defaults,
    definitionIo.default_props,
    definitionIo.defaultProps,
    definitionIo.defaults,
    definitionIo.props_defaults,
  );
}

function validateModuleMetadataForPublish(
  payload: PublishPayload,
  definition: Record<string, unknown>,
  seed: Record<string, unknown>,
  options: ResolvedPublishValidationOptions,
): void {
  if (options.strictMode) {
    if (!hasAnyKeys(definition)) {
      throw new HttpError(400, "Publish validation failed: definition metadata is empty.");
    }
    if (!hasAnyKeys(seed)) {
      throw new HttpError(400, "Publish validation failed: seed metadata is empty.");
    }
  }

  if (options.requirePropsSchema && !resolvePropsSchemaCandidate(definition, seed)) {
    throw new HttpError(
      400,
      "Publish validation failed: props_schema is required in definition/seed metadata for Directus rendering.",
    );
  }

  if (options.requireDefaultProps && !resolveDefaultPropsCandidate(definition, seed)) {
    throw new HttpError(
      400,
      "Publish validation failed: default_props is required in definition/seed metadata for Directus rendering.",
    );
  }

  const definitionIo = isRecord(definition.io) ? definition.io : {};
  const seedIo = isRecord(seed.io) ? seed.io : {};
  const declaredModuleKeys = collectNonEmptyStrings(
    definition.module_key,
    definitionIo.module_key,
    seed.module_key,
    seedIo.module_key,
  );
  const mismatchedModuleKey = declaredModuleKeys.find((item) => item !== payload.module_key);
  if (mismatchedModuleKey) {
    throw new HttpError(400, "Publish validation failed: module_key mismatch between payload and module metadata.", {
      payload_module_key: payload.module_key,
      metadata_module_keys: declaredModuleKeys,
    });
  }

  const payloadProvider = asNonEmptyString(payload.provider);
  if (payloadProvider) {
    const declaredProviders = collectNonEmptyStrings(
      definition.provider,
      definitionIo.provider,
      seed.provider,
      seedIo.provider,
    );
    const mismatchedProvider = declaredProviders.find(
      (provider) => provider.toLowerCase() !== payloadProvider.toLowerCase(),
    );
    if (mismatchedProvider) {
      throw new HttpError(400, "Publish validation failed: provider mismatch between payload and module metadata.", {
        payload_provider: payloadProvider,
        metadata_providers: declaredProviders,
      });
    }
  }
}

function validateManifestCompatibility(payload: PublishPayload, manifest: Record<string, unknown>): void {
  const manifestModuleKey = asNonEmptyString(manifest.module_key);
  if (manifestModuleKey && manifestModuleKey !== payload.module_key) {
    throw new HttpError(400, "Publish validation failed: manifest module_key does not match publish payload.", {
      manifest_module_key: manifestModuleKey,
      payload_module_key: payload.module_key,
    });
  }

  const manifestModuleVersion = asNonEmptyString(manifest.module_version);
  if (manifestModuleVersion && manifestModuleVersion !== payload.module_version) {
    throw new HttpError(
      400,
      "Publish validation failed: manifest module_version does not match publish payload.",
      {
        manifest_module_version: manifestModuleVersion,
        payload_module_version: payload.module_version,
      },
    );
  }

  const manifestChannel = asNonEmptyString(manifest.channel);
  if (manifestChannel && manifestChannel.toLowerCase() !== payload.channel) {
    throw new HttpError(400, "Publish validation failed: manifest channel does not match publish payload.", {
      manifest_channel: manifestChannel,
      payload_channel: payload.channel,
    });
  }

  const manifestBundleUrl = asNonEmptyString(manifest.bundle_url);
  if (manifestBundleUrl && manifestBundleUrl !== payload.bundle_url) {
    throw new HttpError(400, "Publish validation failed: manifest bundle_url does not match publish payload.", {
      manifest_bundle_url: manifestBundleUrl,
      payload_bundle_url: payload.bundle_url,
    });
  }
}

async function verifyHttpResourceReachable(url: string, fieldName: string, timeoutMs: number): Promise<void> {
  let headResponse: Response;
  try {
    headResponse = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow" }, timeoutMs);
  } catch (error) {
    throw new HttpError(400, `Publish validation failed: unable to verify ${fieldName} URL reachability.`, {
      field: fieldName,
      url,
      cause: formatErrorCause(error),
    });
  }

  if (headResponse.ok) {
    return;
  }

  if (headResponse.status === 405 || headResponse.status === 501) {
    let getResponse: Response;
    try {
      getResponse = await fetchWithTimeout(url, { method: "GET", redirect: "follow" }, timeoutMs);
    } catch (error) {
      throw new HttpError(400, `Publish validation failed: unable to verify ${fieldName} URL reachability.`, {
        field: fieldName,
        url,
        cause: formatErrorCause(error),
      });
    }

    if (getResponse.ok) {
      getResponse.body?.cancel();
      return;
    }

    throw new HttpError(400, `Publish validation failed: ${fieldName} URL is not reachable.`, {
      field: fieldName,
      url,
      status: getResponse.status,
      status_text: getResponse.statusText,
    });
  }

  throw new HttpError(400, `Publish validation failed: ${fieldName} URL is not reachable.`, {
    field: fieldName,
    url,
    status: headResponse.status,
    status_text: headResponse.statusText,
  });
}

function uniqueArray<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function extractParameters(definition: Record<string, unknown>, seed: Record<string, unknown>): unknown {
  if (Array.isArray(definition.parameters)) {
    return definition.parameters;
  }

  if (isRecord(definition.props_schema)) {
    const schema = definition.props_schema;
    const props = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];

    return Object.entries(props).map(([key, raw]) => {
      const prop = isRecord(raw) ? raw : {};
      return {
        key,
        type: asNonEmptyString(prop.type),
        description: asNonEmptyString(prop.description),
        default: prop.default,
        required: required.includes(key),
      };
    });
  }

  if (isRecord(seed.default_props)) {
    return Object.keys(seed.default_props).map((key) => ({
      key,
      source: "seed.default_props",
    }));
  }

  return [];
}

function extractIntegrations(definition: Record<string, unknown>, seed: Record<string, unknown>): unknown {
  if (Array.isArray(definition.integrations)) {
    return definition.integrations;
  }

  if (isRecord(definition.integrations)) {
    return definition.integrations;
  }

  if (isRecord(seed.integrations)) {
    return seed.integrations;
  }

  return {};
}

function extractScreenshots(definition: Record<string, unknown>): unknown[] {
  if (Array.isArray(definition.screenshots)) {
    return definition.screenshots;
  }

  const media = definition.media;
  if (isRecord(media) && Array.isArray(media.screenshots)) {
    return media.screenshots;
  }

  return [];
}

function maybeString(value: unknown): string | null {
  return asNonEmptyString(value);
}

function toVersionRecord(row: ModuleVersionRow): ModuleVersionRecord {
  return {
    module_key: row.module_key,
    module_version: row.module_version,
    channel: row.channel,
    bundle_url: row.bundle_url,
    manifest_url: row.manifest_url,
    published_at: row.published_at,
    provider: row.provider,
    component_type: row.component_type,
    release: safeParseJson<Record<string, unknown>>(row.release_json, {}),
    definition_ref: safeParseJson<Record<string, unknown>>(row.definition_ref_json, {}),
    seed_ref: safeParseJson<Record<string, unknown>>(row.seed_ref_json, {}),
    definition: safeParseJson<Record<string, unknown>>(row.definition_json, {}),
    seed: safeParseJson<Record<string, unknown>>(row.seed_json, {}),
    checksums: safeParseJson<Record<string, unknown>>(row.checksums_json, {}),
    screenshots: safeParseJson<unknown[]>(row.screenshots_json, []),
    integrations: safeParseJson<unknown>(row.integrations_json, {}),
    parameters: safeParseJson<unknown>(row.parameters_json, []),
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ListModulesOptions {
  q?: string;
  channel?: "all" | PublishChannel;
  limit?: number;
  offset?: number;
}

export async function ensureRegistrySchema(db: D1Database): Promise<void> {
  if (registrySchemaReady) {
    return;
  }

  if (!registrySchemaInitPromise) {
    registrySchemaInitPromise = (async () => {
      const statements = REGISTRY_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql));
      await db.batch(statements);
      registrySchemaReady = true;
    })();
  }

  try {
    await registrySchemaInitPromise;
  } catch (error) {
    registrySchemaInitPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(500, "Unable to initialize registry database schema.", { cause: message });
  }
}

export async function listModules(db: D1Database, options: ListModulesOptions): Promise<{ items: ModuleSummary[]; total: number }> {
  await ensureRegistrySchema(db);

  const q = (options.q ?? "").trim().toLowerCase();
  const channel = options.channel ?? "all";
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const like = `%${q}%`;

  const whereSql = `
    WHERE
      (? = '' OR lower(m.module_key) LIKE ? OR lower(COALESCE(m.provider, '')) LIKE ? OR lower(COALESCE(m.component_type, '')) LIKE ?)
      AND (
        ? = 'all'
        OR (? = 'preview' AND m.latest_version_preview IS NOT NULL)
        OR (? = 'prod' AND m.latest_version_prod IS NOT NULL)
      )
  `;

  const bindValues = [q, like, like, like, channel, channel, channel] as const;

  const totalResult = await db
    .prepare(`SELECT COUNT(*) AS total FROM modules m ${whereSql}`)
    .bind(...bindValues)
    .first<{ total: number }>();

  const rowsResult = await db
    .prepare(
      `
      SELECT
        m.module_key,
        m.provider,
        m.component_type,
        m.latest_version_preview,
        m.latest_version_prod,
        m.latest_published_at_preview,
        m.latest_published_at_prod,
        m.updated_at,
        (
          SELECT COUNT(*)
          FROM module_versions v
          WHERE v.module_key = m.module_key
        ) AS versions_total
      FROM modules m
      ${whereSql}
      ORDER BY datetime(m.updated_at) DESC, m.module_key ASC
      LIMIT ? OFFSET ?
      `,
    )
    .bind(...bindValues, limit, offset)
    .all<ModuleRow>();

  return {
    items: (rowsResult.results ?? []).map((row) => ({
      module_key: row.module_key,
      provider: row.provider,
      component_type: row.component_type,
      latest_version_preview: row.latest_version_preview,
      latest_version_prod: row.latest_version_prod,
      latest_published_at_preview: row.latest_published_at_preview,
      latest_published_at_prod: row.latest_published_at_prod,
      versions_total: Number(row.versions_total ?? 0),
      updated_at: row.updated_at,
    })),
    total: Number(totalResult?.total ?? 0),
  };
}

export async function getModuleDetails(
  db: D1Database,
  moduleKey: string,
): Promise<{
  module: ModuleSummary;
  versions: ModuleVersionRecord[];
  latest_preview: ModuleVersionRecord | null;
  latest_prod: ModuleVersionRecord | null;
}> {
  await ensureRegistrySchema(db);

  const moduleRow = await db
    .prepare(
      `
      SELECT
        m.module_key,
        m.provider,
        m.component_type,
        m.latest_version_preview,
        m.latest_version_prod,
        m.latest_published_at_preview,
        m.latest_published_at_prod,
        m.updated_at,
        (
          SELECT COUNT(*)
          FROM module_versions v
          WHERE v.module_key = m.module_key
        ) AS versions_total
      FROM modules m
      WHERE m.module_key = ?
      LIMIT 1
      `,
    )
    .bind(moduleKey)
    .first<ModuleRow>();

  if (!moduleRow) {
    throw new HttpError(404, `Module '${moduleKey}' not found.`);
  }

  const versionsResult = await db
    .prepare(
      `
      SELECT
        module_key,
        module_version,
        channel,
        bundle_url,
        manifest_url,
        published_at,
        provider,
        component_type,
        release_json,
        definition_ref_json,
        seed_ref_json,
        definition_json,
        seed_json,
        checksums_json,
        screenshots_json,
        integrations_json,
        parameters_json,
        updated_by,
        created_at,
        updated_at
      FROM module_versions
      WHERE module_key = ?
      ORDER BY datetime(COALESCE(published_at, created_at)) DESC, id DESC
      `,
    )
    .bind(moduleKey)
    .all<ModuleVersionRow>();

  const versions = (versionsResult.results ?? []).map(toVersionRecord);

  const latestPreviewVersion = moduleRow.latest_version_preview;
  const latestProdVersion = moduleRow.latest_version_prod;

  const latest_preview =
    versions.find((item) => item.channel === "preview" && item.module_version === latestPreviewVersion) ?? null;
  const latest_prod =
    versions.find((item) => item.channel === "prod" && item.module_version === latestProdVersion) ?? null;

  return {
    module: {
      module_key: moduleRow.module_key,
      provider: moduleRow.provider,
      component_type: moduleRow.component_type,
      latest_version_preview: moduleRow.latest_version_preview,
      latest_version_prod: moduleRow.latest_version_prod,
      latest_published_at_preview: moduleRow.latest_published_at_preview,
      latest_published_at_prod: moduleRow.latest_published_at_prod,
      versions_total: Number(moduleRow.versions_total ?? 0),
      updated_at: moduleRow.updated_at,
    },
    versions,
    latest_preview,
    latest_prod,
  };
}

export async function getModuleVersion(
  db: D1Database,
  moduleKey: string,
  moduleVersion: string,
  channel?: PublishChannel,
): Promise<ModuleVersionRecord> {
  await ensureRegistrySchema(db);

  const row = await db
    .prepare(
      `
      SELECT
        module_key,
        module_version,
        channel,
        bundle_url,
        manifest_url,
        published_at,
        provider,
        component_type,
        release_json,
        definition_ref_json,
        seed_ref_json,
        definition_json,
        seed_json,
        checksums_json,
        screenshots_json,
        integrations_json,
        parameters_json,
        updated_by,
        created_at,
        updated_at
      FROM module_versions
      WHERE module_key = ?
        AND module_version = ?
        AND (? IS NULL OR channel = ?)
      ORDER BY CASE channel WHEN 'prod' THEN 0 ELSE 1 END
      LIMIT 1
      `,
    )
    .bind(moduleKey, moduleVersion, channel ?? null, channel ?? null)
    .first<ModuleVersionRow>();

  if (!row) {
    throw new HttpError(404, `Module version '${moduleKey}@${moduleVersion}' not found.`);
  }

  return toVersionRecord(row);
}

export interface PromoteModuleVersionOptions {
  publishedAt?: string;
  validationOptions?: PublishValidationOptions;
}

export async function promoteModuleVersion(
  db: D1Database,
  moduleKey: string,
  moduleVersion: string,
  sourceChannel: PublishChannel,
  targetChannel: PublishChannel,
  principal: AuthPrincipal,
  idempotencyKeyHeader: string | null,
  options?: PromoteModuleVersionOptions,
): Promise<Record<string, unknown>> {
  if (sourceChannel === targetChannel) {
    throw new HttpError(400, "source_channel and target_channel must be different.");
  }

  const source = await getModuleVersion(db, moduleKey, moduleVersion, sourceChannel);
  const publishedAt = asNonEmptyString(options?.publishedAt) ?? undefined;

  const payload: PublishPayload = {
    module_key: source.module_key,
    module_version: source.module_version,
    channel: targetChannel,
    published_at: publishedAt,
    provider: source.provider ?? undefined,
    component_type: source.component_type ?? undefined,
    bundle_url: source.bundle_url,
    manifest_url: source.manifest_url,
    release: source.release,
    definition: source.definition,
    seed: source.seed,
    checksums: source.checksums,
  };

  const result = await publishModuleVersion(
    db,
    payload,
    principal,
    JSON.stringify(payload),
    idempotencyKeyHeader,
    options?.validationOptions,
  );

  return {
    ok: true,
    action: "promote",
    module_key: payload.module_key,
    module_version: payload.module_version,
    source_channel: sourceChannel,
    target_channel: targetChannel,
    publish_result: result,
  };
}

async function findExistingPublishResponse(db: D1Database, idempotencyKey: string): Promise<Record<string, unknown> | null> {
  const existing = await db
    .prepare("SELECT response_json FROM publish_events WHERE idempotency_key = ? LIMIT 1")
    .bind(idempotencyKey)
    .first<PublishRow>();

  if (!existing?.response_json) {
    return null;
  }

  const payload = safeParseJson<Record<string, unknown>>(existing.response_json, {});
  return Object.keys(payload).length > 0 ? payload : null;
}

function toStableJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 0);
}

export async function publishModuleVersion(
  db: D1Database,
  payload: PublishPayload,
  principal: AuthPrincipal,
  requestBodyText: string,
  idempotencyKeyHeader: string | null,
  validationOptions?: PublishValidationOptions,
): Promise<Record<string, unknown>> {
  await ensureRegistrySchema(db);

  const validation = resolvePublishValidationOptions(validationOptions);
  const providedManifestDocument = isRecord(validationOptions?.manifestDocument) ? validationOptions?.manifestDocument : null;
  const now = nowIso();
  const publishedAt = payload.published_at ?? now;
  const definitionRef = payload.definition ?? {};
  const seedRef = payload.seed ?? {};

  const definitionUrl = maybeString(definitionRef.url);
  const seedUrl = maybeString(seedRef.url);
  const definitionDoc = await fetchJsonDocument(definitionUrl, definitionRef, {
    fieldName: "definition",
    required: validation.strictMode && definitionUrl !== null,
    timeoutMs: validation.remoteFetchTimeoutMs,
  });
  const seedDoc = await fetchJsonDocument(seedUrl, seedRef, {
    fieldName: "seed",
    required: validation.strictMode && seedUrl !== null,
    timeoutMs: validation.remoteFetchTimeoutMs,
  });

  validateModuleMetadataForPublish(payload, definitionDoc, seedDoc, validation);

  if (validation.validateManifestDocument) {
    const manifestDoc =
      providedManifestDocument ??
      (await fetchJsonDocument(payload.manifest_url, {}, {
        fieldName: "manifest",
        required: true,
        timeoutMs: validation.remoteFetchTimeoutMs,
      }));
    validateManifestCompatibility(payload, manifestDoc);
  }

  if (validation.verifyAssetUrls) {
    await verifyHttpResourceReachable(payload.bundle_url, "bundle_url", validation.remoteFetchTimeoutMs);
    if (!validation.validateManifestDocument) {
      await verifyHttpResourceReachable(payload.manifest_url, "manifest_url", validation.remoteFetchTimeoutMs);
    }
  }

  const integrations = extractIntegrations(definitionDoc, seedDoc);
  const parameters = extractParameters(definitionDoc, seedDoc);
  const screenshots = uniqueArray(extractScreenshots(definitionDoc));

  const checksums = payload.checksums ?? {};
  const bundleSha = asNonEmptyString(checksums.bundle_sha256);

  const fallbackIdempotencySeed = `${payload.module_key}:${payload.module_version}:${payload.channel}:${bundleSha ?? payload.bundle_url}`;
  const idempotencyKey = idempotencyKeyHeader?.trim() || (await hashHexFromText(fallbackIdempotencySeed));
  const requestHash = await hashHexFromText(requestBodyText);

  const existingResponse = await findExistingPublishResponse(db, idempotencyKey);
  if (existingResponse) {
    return {
      ...existingResponse,
      idempotent_replay: true,
    };
  }

  await db
    .prepare(
      `
      INSERT INTO modules (
        module_key,
        provider,
        component_type,
        latest_version_preview,
        latest_version_prod,
        latest_published_at_preview,
        latest_published_at_prod,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(module_key) DO UPDATE SET
        provider = excluded.provider,
        component_type = excluded.component_type,
        updated_at = excluded.updated_at
      `,
    )
    .bind(payload.module_key, payload.provider ?? null, payload.component_type ?? null, now, now)
    .run();

  await db
    .prepare(
      `
      INSERT INTO module_versions (
        module_key,
        module_version,
        channel,
        bundle_url,
        manifest_url,
        published_at,
        provider,
        component_type,
        release_json,
        definition_ref_json,
        seed_ref_json,
        definition_json,
        seed_json,
        checksums_json,
        source_payload_json,
        screenshots_json,
        integrations_json,
        parameters_json,
        updated_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module_key, module_version, channel) DO UPDATE SET
        bundle_url = excluded.bundle_url,
        manifest_url = excluded.manifest_url,
        published_at = excluded.published_at,
        provider = excluded.provider,
        component_type = excluded.component_type,
        release_json = excluded.release_json,
        definition_ref_json = excluded.definition_ref_json,
        seed_ref_json = excluded.seed_ref_json,
        definition_json = excluded.definition_json,
        seed_json = excluded.seed_json,
        checksums_json = excluded.checksums_json,
        source_payload_json = excluded.source_payload_json,
        screenshots_json = excluded.screenshots_json,
        integrations_json = excluded.integrations_json,
        parameters_json = excluded.parameters_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
      `,
    )
    .bind(
      payload.module_key,
      payload.module_version,
      payload.channel,
      payload.bundle_url,
      payload.manifest_url,
      publishedAt,
      payload.provider ?? null,
      payload.component_type ?? null,
      toStableJson(payload.release ?? {}),
      toStableJson(definitionRef),
      toStableJson(seedRef),
      toStableJson(definitionDoc),
      toStableJson(seedDoc),
      toStableJson(checksums),
      requestBodyText,
      toStableJson(screenshots),
      toStableJson(integrations),
      toStableJson(parameters),
      principal.email ?? principal.subject,
      now,
      now,
    )
    .run();

  if (payload.channel === "preview") {
    await db
      .prepare(
        "UPDATE modules SET latest_version_preview = ?, latest_published_at_preview = ?, updated_at = ? WHERE module_key = ?",
      )
      .bind(payload.module_version, publishedAt, now, payload.module_key)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE modules SET latest_version_prod = ?, latest_published_at_prod = ?, updated_at = ? WHERE module_key = ?",
      )
      .bind(payload.module_version, publishedAt, now, payload.module_key)
      .run();
  }

  const responsePayload: Record<string, unknown> = {
    ok: true,
    module_key: payload.module_key,
    module_version: payload.module_version,
    channel: payload.channel,
    updated_at: now,
    idempotency_key: idempotencyKey,
    publisher: {
      subject: principal.subject,
      email: principal.email,
      issuer: principal.issuer,
      audience: principal.audience,
    },
  };

  await db
    .prepare(
      `
      INSERT INTO publish_events (
        idempotency_key,
        module_key,
        module_version,
        channel,
        request_hash,
        principal,
        response_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        request_hash = excluded.request_hash,
        principal = excluded.principal,
        response_json = excluded.response_json,
        created_at = excluded.created_at
      `,
    )
    .bind(
      idempotencyKey,
      payload.module_key,
      payload.module_version,
      payload.channel,
      requestHash,
      principal.email ?? principal.subject,
      JSON.stringify(responsePayload),
      now,
    )
    .run();

  return responsePayload;
}
