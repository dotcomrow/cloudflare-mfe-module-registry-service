import { requireGooglePublishAuth } from "./google-auth";
import { getModuleDetails, getModuleVersion, listModules, publishModuleVersion, validatePublishPayload } from "./registry";
import type { Env, PublishChannel } from "./types";
import { renderIndexHtml } from "./ui";
import { HttpError, jsonResponse } from "./util";

const API_HEADERS: HeadersInit = {
  "cache-control": "no-store",
};

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
  return pathname.startsWith("/api/") || pathname.startsWith("/v1/") || pathname === "/healthz";
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
    const bodyText = await request.text();

    if (bodyText.length > 1024 * 1024) {
      throw new HttpError(413, "Publish payload too large.");
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(bodyText || "{}");
    } catch {
      throw new HttpError(400, "Publish payload must be valid JSON");
    }

    const payload = validatePublishPayload(rawPayload);
    const idempotencyKey = request.headers.get("x-idempotency-key");
    const result = await publishModuleVersion(env.REGISTRY_DB, payload, principal, bodyText, idempotencyKey);

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
