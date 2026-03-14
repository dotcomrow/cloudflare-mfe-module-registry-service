import type { AuthPrincipal, Env } from "./types";
import { HttpError, parseCsv, toBooleanFlag } from "./util";

interface GoogleTokenInfo {
  aud?: string;
  azp?: string;
  email?: string;
  email_verified?: string | boolean;
  sub?: string;
  exp?: string;
  expires_in?: string;
  iss?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GroupServiceAccountConfig {
  allowedGroups: string[];
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  impersonatedUser: string;
  cacheTtlSeconds: number;
  cacheNamespace: string;
}

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

interface CachedMembership {
  isMember: boolean;
  expiresAtMs: number;
}

const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member.readonly";
const GOOGLE_GROUP_MEMBERSHIP_ENDPOINT = "https://admin.googleapis.com/admin/directory/v1/groups";

const accessTokenCache = new Map<string, CachedAccessToken>();
const membershipCache = new Map<string, CachedMembership>();

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
      headers: {
        accept: "application/json",
      },
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

function assertTokenFresh(tokenInfo: GoogleTokenInfo): void {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const exp = Number.parseInt(tokenInfo.exp ?? "", 10);
  if (Number.isFinite(exp) && exp < nowEpoch) {
    throw new HttpError(401, "Google token is expired.");
  }

  const expiresIn = Number.parseInt(tokenInfo.expires_in ?? "", 10);
  if (Number.isFinite(expiresIn) && expiresIn <= 0) {
    throw new HttpError(401, "Google token is expired.");
  }
}

function resolveAllowedAudiences(env: Env): string[] {
  const singleAudience = (env.GOOGLE_AUTH_ALLOWED_AUDIENCE ?? "").trim();
  if (singleAudience) {
    return [singleAudience];
  }
  return parseCsv(env.GOOGLE_AUTH_ALLOWED_AUDIENCES);
}

function assertAudienceAllowed(tokenInfo: GoogleTokenInfo, env: Env): void {
  const allowedAudiences = resolveAllowedAudiences(env);
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

function assertIdentityAllowed(tokenInfo: GoogleTokenInfo, env: Env): void {
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

function getNormalizedEmailForGroupCheck(tokenInfo: GoogleTokenInfo): string {
  const email = (tokenInfo.email ?? "").trim().toLowerCase();
  if (!email) {
    throw new HttpError(403, "Google token must contain email for group membership validation.");
  }

  if (tokenInfo.email_verified === "false" || tokenInfo.email_verified === false) {
    throw new HttpError(403, "Google token email is not verified.");
  }

  return email;
}

function parseCacheTtlSeconds(raw: string | undefined): number {
  const fallback = 300;
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(parsed, 3600));
}

function getGroupServiceAccountConfig(env: Env): GroupServiceAccountConfig | null {
  const allowedGroups = parseCsv(env.GOOGLE_AUTH_ALLOWED_GROUPS).map((item) => item.toLowerCase());
  if (allowedGroups.length === 0) {
    return null;
  }

  const serviceAccountEmail = (env.GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const privateKeyRaw = (env.GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").trim();
  const impersonatedUser = (env.GOOGLE_AUTH_GROUPS_IMPERSONATED_USER ?? "").trim();

  if (!serviceAccountEmail || !privateKeyRaw || !impersonatedUser) {
    throw new HttpError(500, "Google Groups auth is misconfigured. Missing service account settings.", {
      has_service_account_email: serviceAccountEmail.length > 0,
      has_service_account_private_key: privateKeyRaw.length > 0,
      has_impersonated_user: impersonatedUser.length > 0,
    });
  }

  const normalizedPrivateKey = privateKeyRaw.includes("\\n") ? privateKeyRaw.replace(/\\n/g, "\n") : privateKeyRaw;
  const cacheTtlSeconds = parseCacheTtlSeconds(env.GOOGLE_AUTH_GROUPS_CACHE_TTL_SECONDS);

  return {
    allowedGroups,
    serviceAccountEmail,
    serviceAccountPrivateKey: normalizedPrivateKey,
    impersonatedUser,
    cacheTtlSeconds,
    cacheNamespace: `${serviceAccountEmail}|${impersonatedUser}|${GOOGLE_DIRECTORY_SCOPE}`,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJsonBase64Url(payload: Record<string, unknown>): string {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(encoded);
}

function decodePemPkcs8(privateKeyPem: string): ArrayBuffer {
  const normalized = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  if (!normalized) {
    throw new HttpError(500, "Google Groups service account private key is empty.");
  }

  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new HttpError(500, "Google Groups service account private key is not valid base64.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function createServiceAccountAssertion(config: GroupServiceAccountConfig): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claims = {
    iss: config.serviceAccountEmail,
    sub: config.impersonatedUser,
    scope: GOOGLE_DIRECTORY_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encodedHeader = encodeJsonBase64Url(header);
  const encodedClaims = encodeJsonBase64Url(claims);
  const unsignedToken = `${encodedHeader}.${encodedClaims}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodePemPkcs8(config.serviceAccountPrivateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken),
  );

  const encodedSignature = toBase64Url(new Uint8Array(signature));
  return `${unsignedToken}.${encodedSignature}`;
}

async function requestServiceAccountAccessToken(config: GroupServiceAccountConfig): Promise<CachedAccessToken> {
  const assertion = await createServiceAccountAssertion(config);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("groups_access_token_timeout"), 8000);

  try {
    const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new HttpError(503, "Unable to retrieve Google service account access token.", {
        status: response.status,
        error: payload.error ?? null,
        error_description: payload.error_description ?? null,
      });
    }

    const expiresInRaw =
      typeof payload.expires_in === "number"
        ? payload.expires_in
        : Number.parseInt(String(payload.expires_in ?? ""), 10);
    const expiresInSeconds = Number.isFinite(expiresInRaw) ? Math.max(60, expiresInRaw) : 3600;
    const refreshSkewMs = 60_000;

    return {
      token: payload.access_token,
      expiresAtMs: Date.now() + expiresInSeconds * 1000 - refreshSkewMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getServiceAccountAccessToken(config: GroupServiceAccountConfig, forceRefresh = false): Promise<string> {
  const now = Date.now();
  const cached = accessTokenCache.get(config.cacheNamespace);
  if (!forceRefresh && cached && cached.expiresAtMs > now) {
    return cached.token;
  }

  const freshToken = await requestServiceAccountAccessToken(config);
  accessTokenCache.set(config.cacheNamespace, freshToken);
  return freshToken.token;
}

function getMembershipCacheKey(config: GroupServiceAccountConfig, group: string, email: string): string {
  return `${config.cacheNamespace}|${group}|${email}`;
}

function pruneMembershipCacheIfNeeded(): void {
  if (membershipCache.size > 5000) {
    membershipCache.clear();
  }
}

async function checkGroupMembership(
  config: GroupServiceAccountConfig,
  group: string,
  email: string,
): Promise<boolean> {
  const cacheKey = getMembershipCacheKey(config, group, email);
  const now = Date.now();
  const cached = membershipCache.get(cacheKey);

  if (config.cacheTtlSeconds > 0 && cached && cached.expiresAtMs > now) {
    return cached.isMember;
  }

  const endpoint = `${GOOGLE_GROUP_MEMBERSHIP_ENDPOINT}/${encodeURIComponent(group)}/hasMember/${encodeURIComponent(email)}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getServiceAccountAccessToken(config, attempt > 0);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("groups_membership_timeout"), 8000);

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });

      const payload = (await response.json().catch(() => ({}))) as { isMember?: boolean; error?: { message?: string } };

      if ((response.status === 401 || response.status === 403) && attempt === 0) {
        accessTokenCache.delete(config.cacheNamespace);
        continue;
      }

      if (!response.ok) {
        throw new HttpError(503, "Google Groups membership lookup failed.", {
          status: response.status,
          group,
          email,
          message: payload.error?.message ?? null,
        });
      }

      const isMember = payload.isMember === true;

      if (config.cacheTtlSeconds > 0) {
        pruneMembershipCacheIfNeeded();
        membershipCache.set(cacheKey, {
          isMember,
          expiresAtMs: Date.now() + config.cacheTtlSeconds * 1000,
        });
      }

      return isMember;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new HttpError(503, "Google Groups membership lookup failed after retry.", {
    group,
    email,
  });
}

async function assertGroupMembershipAllowed(tokenInfo: GoogleTokenInfo, env: Env): Promise<void> {
  const config = getGroupServiceAccountConfig(env);
  if (!config) {
    return;
  }

  const email = getNormalizedEmailForGroupCheck(tokenInfo);

  for (const group of config.allowedGroups) {
    const isMember = await checkGroupMembership(config, group, email);
    if (isMember) {
      return;
    }
  }

  throw new HttpError(403, "Google token user is not a member of an allowed Google Group.", {
    email,
    allowed_groups: config.allowedGroups,
  });
}

export async function requireGooglePublishAuth(request: Request, env: Env): Promise<AuthPrincipal> {
  const authEnabled = toBooleanFlag(env.GOOGLE_AUTH_ENABLED, true);
  if (!authEnabled) {
    return {
      subject: "auth-disabled",
      email: null,
      issuer: "local",
      audience: null,
    };
  }

  const token = extractBearerToken(request);

  const idTokenInfo = await fetchGoogleTokenInfo(token, "id_token");
  const tokenInfo = idTokenInfo ?? (await fetchGoogleTokenInfo(token, "access_token"));

  if (!tokenInfo || tokenInfo.error) {
    throw new HttpError(401, "Google token validation failed.", tokenInfo ?? undefined);
  }

  assertTokenFresh(tokenInfo);
  assertAudienceAllowed(tokenInfo, env);
  assertIdentityAllowed(tokenInfo, env);
  await assertGroupMembershipAllowed(tokenInfo, env);

  return {
    subject: tokenInfo.sub ?? tokenInfo.email ?? tokenInfo.aud ?? "google-token",
    email: tokenInfo.email ?? null,
    issuer: tokenInfo.iss ?? "google",
    audience: tokenInfo.aud ?? tokenInfo.azp ?? null,
  };
}
