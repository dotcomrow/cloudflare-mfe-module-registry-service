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

async function fetchJsonDocument(url: string | null, fallback: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!url) {
    return fallback;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("json_fetch_timeout"), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return fallback;
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (isRecord(payload)) {
      return payload;
    }

    return fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
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
): Promise<Record<string, unknown>> {
  await ensureRegistrySchema(db);

  const now = nowIso();
  const publishedAt = payload.published_at ?? now;
  const definitionRef = payload.definition ?? {};
  const seedRef = payload.seed ?? {};

  const definitionUrl = maybeString(definitionRef.url);
  const seedUrl = maybeString(seedRef.url);
  const definitionDoc = await fetchJsonDocument(definitionUrl, definitionRef);
  const seedDoc = await fetchJsonDocument(seedUrl, seedRef);

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
