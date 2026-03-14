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
  error?: string;
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

  return {
    subject: tokenInfo.sub ?? tokenInfo.email ?? tokenInfo.aud ?? "google-token",
    email: tokenInfo.email ?? null,
    issuer: tokenInfo.iss ?? "google",
    audience: tokenInfo.aud ?? tokenInfo.azp ?? null,
  };
}
