export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function jsonResponse(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export function textResponse(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }
  return new Response(body, { status, headers });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function toBooleanFlag(input: string | undefined, defaultValue: boolean): boolean {
  if (typeof input !== "string" || input.trim() === "") {
    return defaultValue;
  }
  const normalized = input.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function safeParseObject(input: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return fallback;
}

export function safeParseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) {
    return fallback;
  }
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function hashHexFromText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => {
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map((item) => item.toString(16).padStart(2, "0")).join("");
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
