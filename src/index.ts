import { requireGooglePublishAuth } from "./google-auth";
import { getModuleDetails, getModuleVersion, listModules, publishModuleVersion, validatePublishPayload } from "./registry";
import type { Env, PublishChannel, PublishPayload } from "./types";
import { renderIndexHtml } from "./ui";
import { HttpError, isRecord, jsonResponse, toBooleanFlag } from "./util";

const API_HEADERS: HeadersInit = {
  "cache-control": "no-store",
};

const MAX_JSON_PUBLISH_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

interface ParsedPublishRequest {
  payload: PublishPayload;
  requestBodyText: string;
  manifestDocument: Record<string, unknown> | null;
}

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-idempotency-key");
  headers.set("access-control-max-age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/")
    || pathname.startsWith("/v1/")
    || pathname.startsWith("/assets/")
    || pathname === "/healthz"
  );
}

function parsePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Invalid URL path encoding.");
  }
}

function parseChannelParam(raw: string | null): "all" | PublishChannel {
  const value = (raw ?? "all").trim().toLowerCase();
  if (value === "all" || value === "preview" || value === "prod") {
    return value;
  }
  throw new HttpError(400, "Invalid channel query parameter.");
}

function parseIntegerParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseByteLimit(raw: string | undefined, fallback: number): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeUploadPrefix(raw: string | undefined): string {
  const trimmed = (raw ?? "modules").trim().replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? trimmed : "modules";
}

function getFileExtension(fileName: string, fallback: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0) {
    return fallback;
  }
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext)) {
    return fallback;
  }
  return `.${ext}`;
}

function encodeObjectKeyForUrl(key: string): string {
  return key
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildPublicAssetUrl(baseUrl: string, objectKey: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/g, "");
  const encodedKey = encodeObjectKeyForUrl(objectKey);
  return `${normalizedBase}/${encodedKey}`;
}

function resolvePublicAssetBaseUrl(request: Request, env: Env): string {
  const configuredBaseUrl = (env.PUBLISH_UPLOADS_PUBLIC_BASE_URL ?? "").trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  return `${new URL(request.url).origin}/assets`;
}

function parseAssetObjectKey(pathname: string): string {
  const rawPath = pathname.startsWith("/assets/") ? pathname.slice("/assets/".length) : "";
  if (!rawPath) {
    throw new HttpError(404, "Asset path is required.");
  }

  const segments = rawPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(parsePathSegment);

  if (segments.length === 0) {
    throw new HttpError(404, "Asset path is required.");
  }

  return segments.join("/");
}

function getRequiredPayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `Publish payload is missing required field '${key}'.`);
  }
  return value.trim();
}

function parsePayloadChannel(payload: Record<string, unknown>): PublishChannel {
  const channel = getRequiredPayloadString(payload, "channel").toLowerCase();
  if (channel !== "preview" && channel !== "prod") {
    throw new HttpError(400, "Invalid publish channel. Expected 'preview' or 'prod'.");
  }
  return channel;
}

function parseOptionalJsonField(entry: FormDataEntryValue | null, fieldName: string): unknown {
  if (entry === null) {
    return undefined;
  }
  if (typeof entry !== "string") {
    throw new HttpError(400, `${fieldName} must be JSON text when provided.`);
  }
  const trimmed = entry.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new HttpError(400, `${fieldName} must be valid JSON.`);
  }
}

function parseOptionalStringField(entry: FormDataEntryValue | null): string | undefined {
  if (entry === null) {
    return undefined;
  }
  if (typeof entry !== "string") {
    throw new HttpError(400, "Multipart field must be text.");
  }
  const trimmed = entry.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseMultipartFields(form: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  const scalarFields = [
    "module_key",
    "module_version",
    "channel",
    "published_at",
    "provider",
    "component_type",
    "bundle_url",
    "manifest_url",
  ] as const;

  for (const field of scalarFields) {
    const value = parseOptionalStringField(form.get(field));
    if (typeof value === "string") {
      payload[field] = value;
    }
  }

  const release = parseOptionalJsonField(form.get("release"), "release");
  const definition = parseOptionalJsonField(form.get("definition"), "definition");
  const seed = parseOptionalJsonField(form.get("seed"), "seed");
  const checksums = parseOptionalJsonField(form.get("checksums"), "checksums");

  if (release !== undefined) {
    payload.release = release;
  }
  if (definition !== undefined) {
    payload.definition = definition;
  }
  if (seed !== undefined) {
    payload.seed = seed;
  }
  if (checksums !== undefined) {
    payload.checksums = checksums;
  }

  return payload;
}

async function uploadPublishAssetToR2(
  env: Env,
  publicBaseUrl: string,
  payload: Record<string, unknown>,
  file: File,
  kind: "bundle" | "manifest",
): Promise<{ objectKey: string; url: string }> {
  if (!toBooleanFlag(env.PUBLISH_UPLOADS_ENABLED, true)) {
    throw new HttpError(403, "Direct file uploads are disabled for this environment.");
  }

  if (!env.REGISTRY_ASSETS || typeof env.REGISTRY_ASSETS.put !== "function") {
    throw new HttpError(500, "REGISTRY_ASSETS binding is not configured.");
  }

  const maxBytes =
    kind === "bundle"
      ? parseByteLimit(env.PUBLISH_UPLOADS_MAX_BUNDLE_BYTES, DEFAULT_MAX_BUNDLE_BYTES)
      : parseByteLimit(env.PUBLISH_UPLOADS_MAX_MANIFEST_BYTES, DEFAULT_MAX_MANIFEST_BYTES);

  if (file.size <= 0) {
    throw new HttpError(400, `${kind}_file is empty.`);
  }
  if (file.size > maxBytes) {
    throw new HttpError(413, `${kind}_file exceeds maximum size (${maxBytes} bytes).`);
  }

  const moduleKey = sanitizePathSegment(getRequiredPayloadString(payload, "module_key"), "module");
  const moduleVersion = sanitizePathSegment(getRequiredPayloadString(payload, "module_version"), "version");
  const channel = parsePayloadChannel(payload);
  const prefix = normalizeUploadPrefix(env.PUBLISH_UPLOADS_R2_PREFIX);

  const fallbackExtension = kind === "bundle" ? ".js" : ".json";
  const extension = getFileExtension(file.name, fallbackExtension);
  const objectKey = `${prefix}/${channel}/${moduleKey}/${moduleVersion}/${kind}${extension}`;

  const fallbackContentType = kind === "bundle" ? "application/javascript" : "application/json";

  await env.REGISTRY_ASSETS.put(objectKey, file, {
    httpMetadata: {
      contentType: file.type || fallbackContentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      module_key: moduleKey,
      module_version: moduleVersion,
      channel,
      asset_kind: kind,
    },
  });

  return {
    objectKey,
    url: buildPublicAssetUrl(publicBaseUrl, objectKey),
  };
}

async function parseMultipartPublishRequest(request: Request, env: Env): Promise<ParsedPublishRequest> {
  const form = await request.formData();
  const publicBaseUrl = resolvePublicAssetBaseUrl(request, env);
  let manifestDocument: Record<string, unknown> | null = null;

  const formPayload = parseMultipartFields(form);
  let rawPayload: Record<string, unknown> = formPayload;

  const payloadEntry = form.get("payload");
  if (payloadEntry !== null) {
    if (typeof payloadEntry !== "string") {
      throw new HttpError(400, "payload field must be JSON text.");
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payloadEntry.trim() || "{}");
    } catch {
      throw new HttpError(400, "payload field must contain valid JSON.");
    }

    if (!isRecord(parsedPayload)) {
      throw new HttpError(400, "payload field must contain a JSON object.");
    }

    rawPayload = { ...formPayload, ...parsedPayload };
  }

  const bundleFile = form.get("bundle_file");
  const manifestFile = form.get("manifest_file");

  if (bundleFile !== null) {
    if (!(bundleFile instanceof File)) {
      throw new HttpError(400, "bundle_file must be a file.");
    }
    const uploaded = await uploadPublishAssetToR2(env, publicBaseUrl, rawPayload, bundleFile, "bundle");
    rawPayload.bundle_url = uploaded.url;
  }

  if (manifestFile !== null) {
    if (!(manifestFile instanceof File)) {
      throw new HttpError(400, "manifest_file must be a file.");
    }

    const manifestText = await manifestFile.text();
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(manifestText);
    } catch {
      throw new HttpError(400, "manifest_file must contain valid JSON.");
    }
    if (!isRecord(parsedManifest)) {
      throw new HttpError(400, "manifest_file must contain a JSON object.");
    }
    manifestDocument = parsedManifest;

    const uploaded = await uploadPublishAssetToR2(env, publicBaseUrl, rawPayload, manifestFile, "manifest");
    rawPayload.manifest_url = uploaded.url;
  }

  const payload = validatePublishPayload(rawPayload);

  const requestBodyText = JSON.stringify({
    payload,
    uploads: {
      bundle_file:
        bundleFile instanceof File
          ? {
              name: bundleFile.name,
              size: bundleFile.size,
              type: bundleFile.type,
            }
          : null,
      manifest_file:
        manifestFile instanceof File
          ? {
              name: manifestFile.name,
              size: manifestFile.size,
              type: manifestFile.type,
            }
          : null,
    },
  });

  return {
    payload,
    requestBodyText,
    manifestDocument,
  };
}

async function parseJsonPublishRequest(request: Request): Promise<ParsedPublishRequest> {
  const bodyText = await request.text();

  if (bodyText.length > MAX_JSON_PUBLISH_BODY_BYTES) {
    throw new HttpError(413, "Publish payload too large.");
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(bodyText || "{}");
  } catch {
    throw new HttpError(400, "Publish payload must be valid JSON.");
  }

  const payload = validatePublishPayload(rawPayload);
  return {
    payload,
    requestBodyText: bodyText || "{}",
    manifestDocument: null,
  };
}

async function parsePublishRequest(request: Request, env: Env): Promise<ParsedPublishRequest> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    return parseMultipartPublishRequest(request, env);
  }
  return parseJsonPublishRequest(request);
}

function buildErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      {
        error: error.message,
        details: error.details,
      },
      error.status,
      API_HEADERS,
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  return jsonResponse(
    {
      error: message,
    },
    500,
    API_HEADERS,
  );
}

async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if ((request.method === "GET" || request.method === "HEAD") && pathname.startsWith("/assets/")) {
    if (!env.REGISTRY_ASSETS || typeof env.REGISTRY_ASSETS.get !== "function") {
      throw new HttpError(500, "REGISTRY_ASSETS binding is not configured.");
    }

    const objectKey = parseAssetObjectKey(pathname);
    const object = await env.REGISTRY_ASSETS.get(objectKey);
    if (!object) {
      throw new HttpError(404, "Asset not found.");
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    if (!headers.has("cache-control")) {
      headers.set("cache-control", "public, max-age=31536000, immutable");
    }

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });
  }

  if (request.method === "GET" && pathname === "/healthz") {
    return jsonResponse(
      {
        ok: true,
        service: env.SERVICE_TITLE ?? "MFE Module Registry",
        environment: env.ENVIRONMENT ?? "unknown",
        time: new Date().toISOString(),
      },
      200,
      API_HEADERS,
    );
  }

  if (request.method === "GET" && pathname === "/api/modules") {
    const channel = parseChannelParam(url.searchParams.get("channel"));
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = parseIntegerParam(url.searchParams.get("limit"), 100, 1, 500);
    const offset = parseIntegerParam(url.searchParams.get("offset"), 0, 0, 50000);

    const result = await listModules(env.REGISTRY_DB, {
      q,
      channel,
      limit,
      offset,
    });

    return jsonResponse(
      {
        items: result.items,
        total: result.total,
        channel,
        query: q,
        limit,
        offset,
      },
      200,
      API_HEADERS,
    );
  }

  if (request.method === "GET" && pathname.startsWith("/api/modules/")) {
    const parts = pathname.split("/").filter(Boolean);

    if (parts.length === 3) {
      const moduleKey = parsePathSegment(parts[2]);
      const result = await getModuleDetails(env.REGISTRY_DB, moduleKey);
      return jsonResponse(result, 200, API_HEADERS);
    }

    if (parts.length === 4) {
      const moduleKey = parsePathSegment(parts[2]);
      const moduleVersion = parsePathSegment(parts[3]);
      const channelParam = url.searchParams.get("channel");
      const channel = channelParam ? parseChannelParam(channelParam) : undefined;
      const result = await getModuleVersion(
        env.REGISTRY_DB,
        moduleKey,
        moduleVersion,
        channel === "all" ? undefined : channel,
      );
      return jsonResponse(result, 200, API_HEADERS);
    }
  }

  if (request.method === "POST" && pathname === "/v1/modules/publish") {
    const principal = await requireGooglePublishAuth(request, env);
    const { payload, requestBodyText, manifestDocument } = await parsePublishRequest(request, env);
    const idempotencyKey = request.headers.get("x-idempotency-key");
    const strictValidation = toBooleanFlag(env.PUBLISH_VALIDATION_STRICT, true);
    const validationOptions = {
      strictMode: strictValidation,
      requirePropsSchema: toBooleanFlag(env.PUBLISH_VALIDATION_REQUIRE_PROPS_SCHEMA, strictValidation),
      requireDefaultProps: toBooleanFlag(env.PUBLISH_VALIDATION_REQUIRE_DEFAULT_PROPS, strictValidation),
      verifyAssetUrls: toBooleanFlag(env.PUBLISH_VALIDATION_VERIFY_ASSET_URLS, false),
      validateManifestDocument: toBooleanFlag(env.PUBLISH_VALIDATION_VALIDATE_MANIFEST, strictValidation),
      remoteFetchTimeoutMs: parseBoundedInteger(env.PUBLISH_VALIDATION_TIMEOUT_MS, 8000, 1000, 30000),
      manifestDocument,
    };

    const result = await publishModuleVersion(
      env.REGISTRY_DB,
      payload,
      principal,
      requestBodyText,
      idempotencyKey,
      validationOptions,
    );
    return jsonResponse(result, 200, API_HEADERS);
  }

  throw new HttpError(404, `Route not found: ${request.method} ${pathname}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS" && isApiPath(pathname)) {
      return addCorsHeaders(new Response(null, { status: 204 }));
    }

    if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return new Response(renderIndexHtml(env.SERVICE_TITLE ?? "MFE Module Registry"), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    try {
      const response = await handleApiRequest(request, env);
      if (isApiPath(pathname)) {
        return addCorsHeaders(response);
      }
      return response;
    } catch (error) {
      const response = buildErrorResponse(error);
      if (isApiPath(pathname)) {
        return addCorsHeaders(response);
      }
      return response;
    }
  },
};
