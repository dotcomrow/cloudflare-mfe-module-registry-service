import type { AuthPrincipal, Env } from "./types";
import { HttpError, isRecord, parseCsv, safeParseJson, toBooleanFlag } from "./util";

interface GoogleTokenInfo {
  aud?: string;
  azp?: string;
  email?: string;
  email_verified?: string | boolean;
  sub?: string;
  exp?: string;
  expires_in?: string;
  iss?: string;
  error?: string;
}

interface KeycloakAuthConfig {
  issuer: string;
  userinfoUrl: string;
  requiredRole: string;
  audience?: string;
  userinfoTimeoutMs: number;
}

function extractBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing Authorization Bearer token.");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new HttpError(401, "Authorization token is empty.");
  }
  return token;
}

function parseNumericTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePositiveTimeout(value: string | undefined, fallback: number): number {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1000, Math.min(parsed, 60000));
}

function collectStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? [normalized] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function decodeBase64UrlText(base64url: string): string {
  const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payloadText = decodeBase64UrlText(parts[1]);
    const payload = JSON.parse(payloadText);
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveGoogleAllowedAudiences(env: Env): string[] {
  const singleAudience = (env.GOOGLE_AUTH_ALLOWED_AUDIENCE ?? "").trim();
  if (singleAudience) {
    return [singleAudience];
  }
  return parseCsv(env.GOOGLE_AUTH_ALLOWED_AUDIENCES);
}

function assertTokenFresh(tokenInfo: { exp?: string; expires_in?: string }): void {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const exp = parseNumericTimestamp(tokenInfo.exp);
  if (exp !== null && exp < nowEpoch) {
    throw new HttpError(401, "Google token is expired.");
  }

  const expiresIn = parseNumericTimestamp(tokenInfo.expires_in);
  if (expiresIn !== null && expiresIn <= 0) {
    throw new HttpError(401, "Google token is expired.");
  }
}

function assertGoogleAudienceAllowed(tokenInfo: GoogleTokenInfo, env: Env): void {
  const allowedAudiences = resolveGoogleAllowedAudiences(env);
  if (allowedAudiences.length === 0) {
    return;
  }

  const audienceCandidates = [tokenInfo.aud, tokenInfo.azp].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  const hasAllowedAudience = audienceCandidates.some((candidate) => allowedAudiences.includes(candidate));
  if (!hasAllowedAudience) {
    throw new HttpError(403, "Google token audience is not allowed.", {
      expected_audiences: allowedAudiences,
      token_audience: audienceCandidates,
    });
  }
}

function assertGoogleIdentityAllowed(tokenInfo: GoogleTokenInfo, env: Env): void {
  const allowedEmails = parseCsv(env.GOOGLE_AUTH_ALLOWED_EMAILS).map((item) => item.toLowerCase());
  const allowedDomains = parseCsv(env.GOOGLE_AUTH_ALLOWED_DOMAINS).map((item) => item.toLowerCase());

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    return;
  }

  const email = (tokenInfo.email ?? "").trim().toLowerCase();
  if (!email) {
    throw new HttpError(403, "Google token must contain email for allow-list validation.");
  }

  if (tokenInfo.email_verified === "false" || tokenInfo.email_verified === false) {
    throw new HttpError(403, "Google token email is not verified.");
  }

  if (allowedEmails.length > 0 && allowedEmails.includes(email)) {
    return;
  }

  const domain = email.split("@")[1] ?? "";
  if (allowedDomains.length > 0 && allowedDomains.includes(domain)) {
    return;
  }

  throw new HttpError(403, "Google token email/domain is not allowed.", {
    email,
    allowed_emails: allowedEmails,
    allowed_domains: allowedDomains,
  });
}

async function fetchGoogleTokenInfo(token: string, mode: "id_token" | "access_token"): Promise<GoogleTokenInfo | null> {
  const endpoint =
    mode === "id_token"
      ? `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
      : `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("tokeninfo_timeout"), 8000);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    const payload = (await response.json().catch(() => ({}))) as GoogleTokenInfo;
    if (!response.ok) {
      return null;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function getTokenAudiences(payload: Record<string, unknown>): string[] {
  const audField = payload.aud;
  if (typeof audField === "string") {
    return [audField];
  }
  return collectStringArray(audField);
}

function resolveKeycloakAuthConfig(env: Env, tokenIssuer: string = ""): KeycloakAuthConfig | null {
  if (!toBooleanFlag(env.KEYCLOAK_AUTH_ENABLED, false)) {
    return null;
  }

  const configuredIssuer = normalizeIssuer(env.KEYCLOAK_AUTH_ISSUER ?? "");
  const normalizedTokenIssuer = normalizeIssuer(tokenIssuer);
  const issuer = configuredIssuer || normalizedTokenIssuer;
  if (!issuer) {
    return null;
  }

  const configuredUserinfoUrl = (env.KEYCLOAK_AUTH_USERINFO_URL ?? "").trim();
  const userinfoUrl = configuredUserinfoUrl.length > 0 ? configuredUserinfoUrl : `${issuer}/protocol/openid-connect/userinfo`;
  const requiredRole = (env.KEYCLOAK_AUTH_REQUIRED_ROLE ?? "").trim() || "mfe-registry-access";
  const audience = (env.KEYCLOAK_AUTH_AUDIENCE ?? "").trim();
  const userinfoTimeoutMs = parsePositiveTimeout(env.KEYCLOAK_AUTH_USERINFO_TIMEOUT_MS, 8000);

  return {
    issuer,
    userinfoUrl,
    requiredRole,
    audience: audience || undefined,
    userinfoTimeoutMs,
  };
}

function looksLikeKeycloakToken(payload: Record<string, unknown>, config: KeycloakAuthConfig): boolean {
  const tokenIssuer = normalizeIssuer(String(payload.iss ?? ""));
  if (!tokenIssuer) {
    return false;
  }

  if (config.issuer) {
    return tokenIssuer === config.issuer;
  }

  return tokenIssuer.includes("/realms/") || collectStringArray(payload.suncoast_roles).length > 0;
}

function assertKeycloakClaims(payload: Record<string, unknown>, config: KeycloakAuthConfig): void {
  const tokenIssuer = normalizeIssuer(String(payload.iss ?? ""));
  if (!tokenIssuer || tokenIssuer !== config.issuer) {
    throw new HttpError(403, "Keycloak token issuer is not allowed.", {
      expected_issuer: config.issuer,
      token_issuer: tokenIssuer,
    });
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const exp = parseNumericTimestamp(payload.exp);
  if (exp !== null && exp <= nowEpoch) {
    throw new HttpError(401, "Keycloak token is expired.");
  }

  const nbf = parseNumericTimestamp(payload.nbf);
  if (nbf !== null && nbf > nowEpoch) {
    throw new HttpError(401, "Keycloak token is not yet valid.");
  }

  if (config.audience) {
    const audienceCandidates = getTokenAudiences(payload);
    if (!audienceCandidates.includes(config.audience)) {
      throw new HttpError(403, "Keycloak token audience is not allowed.", {
        expected_audience: config.audience,
        token_audiences: audienceCandidates,
      });
    }
  }
}

function assertKeycloakRole(
  payload: Record<string, unknown>,
  userinfo: Record<string, unknown>,
  requiredRole: string,
): void {
  const roles = new Set([
    ...collectStringArray(payload.suncoast_roles),
    ...collectKeycloakRoleClaims(payload),
    ...collectKeycloakRoleClaims(userinfo),
  ]);
  if (!roles.has(requiredRole)) {
    throw new HttpError(403, "Keycloak token does not include required role.", {
      required_role: requiredRole,
      roles_claims: ["suncoast_roles", "realm_access.roles", "resource_access.*.roles"],
    });
  }
}

function collectKeycloakRoleClaims(payload: Record<string, unknown>): string[] {
  const roles = new Set<string>(collectStringArray(payload.suncoast_roles));

  const realmAccess = payload.realm_access;
  if (isRecord(realmAccess)) {
    collectStringArray(realmAccess.roles).forEach((role) => roles.add(role));
  }

  const resourceAccess = payload.resource_access;
  if (isRecord(resourceAccess)) {
    for (const entry of Object.values(resourceAccess)) {
      if (!isRecord(entry)) {
        continue;
      }
      collectStringArray(entry.roles).forEach((role) => roles.add(role));
    }
  }

  return [...roles];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchKeycloakUserInfo(token: string, userinfoUrl: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(userinfoUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
      });

      const payloadText = await response.text().catch(() => "");
      if (!response.ok) {
        throw new HttpError(401, "Keycloak userinfo validation failed.", {
          userinfo_url: userinfoUrl,
          status: response.status,
          status_text: response.statusText,
          body: payloadText,
        });
      }

      const payload = safeParseJson(payloadText, {});
      if (!isRecord(payload)) {
        throw new HttpError(401, "Keycloak userinfo response was invalid.", {
          userinfo_url: userinfoUrl,
          body: payloadText,
        });
      }
      return payload;
    } catch (error: unknown) {
      lastError = error;
      if (error instanceof HttpError) {
        throw error;
      }

      const name = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : "unknown_error";
      const timedOut =
        name === "AbortError" ||
        message === "keycloak_userinfo_timeout" ||
        message.includes("aborted");

      if (timedOut && attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }

      throw new HttpError(
        401,
        timedOut ? "Keycloak userinfo request timed out." : "Keycloak userinfo request failed.",
        {
          userinfo_url: userinfoUrl,
          attempts: attempt,
          timeout_ms: timeoutMs,
          error_name: name,
          error: message,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new HttpError(401, "Keycloak userinfo request failed.", {
    userinfo_url: userinfoUrl,
    attempts: maxAttempts,
    cause: (lastError as Error | null)?.message ?? "unknown_error",
  });
}

async function requireGooglePublishAuthFromToken(token: string, env: Env): Promise<AuthPrincipal> {
  const idTokenInfo = await fetchGoogleTokenInfo(token, "id_token");
  const tokenInfo = idTokenInfo ?? (await fetchGoogleTokenInfo(token, "access_token"));

  if (!tokenInfo || tokenInfo.error) {
    throw new HttpError(401, "Google token validation failed.", tokenInfo ?? undefined);
  }

  assertTokenFresh(tokenInfo);
  assertGoogleAudienceAllowed(tokenInfo, env);
  assertGoogleIdentityAllowed(tokenInfo, env);

  return {
    subject: tokenInfo.sub ?? tokenInfo.email ?? tokenInfo.aud ?? "google-token",
    email: tokenInfo.email ?? null,
    issuer: tokenInfo.iss ?? "google",
    audience: tokenInfo.aud ?? tokenInfo.azp ?? null,
  };
}

async function requireKeycloakPublishAuthFromToken(token: string, env: Env): Promise<AuthPrincipal> {
  const parsedPayload = parseJwtPayload(token);
  const tokenIssuer = normalizeIssuer(String(parsedPayload?.iss ?? ""));
  const keycloakConfig = resolveKeycloakAuthConfig(env, tokenIssuer);
  if (!keycloakConfig) {
    throw new HttpError(401, "Keycloak auth is not configured.");
  }

  const payload = parsedPayload ?? parseJwtPayload(token);
  if (!payload) {
    throw new HttpError(401, "Invalid Keycloak token payload.");
  }

  assertKeycloakClaims(payload, keycloakConfig);

  const userinfo = await fetchKeycloakUserInfo(token, keycloakConfig.userinfoUrl, keycloakConfig.userinfoTimeoutMs);

  assertKeycloakRole(payload, userinfo, keycloakConfig.requiredRole);

  const email =
    typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : null;
  const subject =
    typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : typeof payload.preferred_username === "string" && payload.preferred_username.length > 0
        ? payload.preferred_username
        : "keycloak-token";

  return {
    subject,
    email,
    issuer: payload.iss?.toString() ?? "keycloak",
    audience: getTokenAudiences(userinfo)[0] ?? getTokenAudiences(payload)[0] ?? null,
  };
}

export async function requirePublishAuth(request: Request, env: Env): Promise<AuthPrincipal> {
  const googleAuthEnabled = toBooleanFlag(env.GOOGLE_AUTH_ENABLED, true);
  const keycloakAuthEnabled = toBooleanFlag(env.KEYCLOAK_AUTH_ENABLED, false);

  if (!googleAuthEnabled && !keycloakAuthEnabled) {
    return {
      subject: "auth-disabled",
      email: null,
      issuer: "local",
      audience: null,
    };
  }

  const token = extractBearerToken(request);
  const payload = parseJwtPayload(token);
  const tokenIssuer = normalizeIssuer(String(payload?.iss ?? ""));
  const keycloakConfig = resolveKeycloakAuthConfig(env, tokenIssuer);

  if (keycloakConfig !== null && payload !== null && looksLikeKeycloakToken(payload, keycloakConfig)) {
    return requireKeycloakPublishAuthFromToken(token, env);
  }

  if (googleAuthEnabled) {
    return requireGooglePublishAuthFromToken(token, env);
  }

  if (keycloakAuthEnabled && keycloakConfig !== null) {
    return requireKeycloakPublishAuthFromToken(token, env);
  }

  throw new HttpError(401, "No publish auth provider is configured.");
}

export async function requireGooglePublishAuth(request: Request, env: Env): Promise<AuthPrincipal> {
  const googleAuthEnabled = toBooleanFlag(env.GOOGLE_AUTH_ENABLED, true);
  if (!googleAuthEnabled) {
    return {
      subject: "auth-disabled",
      email: null,
      issuer: "local",
      audience: null,
    };
  }

  const token = extractBearerToken(request);
  return requireGooglePublishAuthFromToken(token, env);
}
