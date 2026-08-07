/**
 * Client Bungie côté serveur uniquement.
 * L'API key et le client secret ne quittent jamais le serveur.
 */

const PLATFORM = "https://www.bungie.net/Platform";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name} (voir README)`);
  return v;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  membership_id: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(
    `${env("BUNGIE_CLIENT_ID")}:${env("BUNGIE_CLIENT_SECRET")}`
  ).toString("base64");

  const res = await fetch(`${PLATFORM}/App/OAuth/Token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Échec OAuth Bungie (${res.status}) : ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code })
  );
}

export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  );
}

/** POST authentifié sur l'API Platform. Lève une erreur si ErrorCode !== 1. */
export async function bungiePost<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  const res = await fetch(`${PLATFORM}${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": env("BUNGIE_API_KEY"),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as {
    ErrorCode?: number;
    Message?: string;
    Response?: T;
  } | null;

  if (!res.ok || !json || json.ErrorCode !== 1) {
    const msg = json?.Message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.Response as T;
}

/** GET sur l'API Platform. Lève une erreur si ErrorCode !== 1. */
export async function bungieGet<T>(path: string, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = { "X-API-Key": env("BUNGIE_API_KEY") };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${PLATFORM}${path}`, { headers, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as {
    ErrorCode?: number;
    Message?: string;
    Response?: T;
  } | null;

  if (!res.ok || !json || json.ErrorCode !== 1 || json.Response === undefined) {
    const msg = json?.Message ?? `HTTP ${res.status}`;
    throw new Error(`API Bungie : ${msg}`);
  }
  return json.Response;
}

interface DestinyMembership {
  membershipType: number;
  membershipId: string;
  displayName?: string;
  bungieGlobalDisplayName?: string;
}

/** Récupère le compte Destiny principal (gère le cross-save). */
export async function getPrimaryDestinyMembership(accessToken: string) {
  const resp = await bungieGet<{
    destinyMemberships: DestinyMembership[];
    primaryMembershipId?: string;
    bungieNetUser?: { uniqueName?: string; displayName?: string };
  }>("/User/GetMembershipsForCurrentUser/", accessToken);

  const list = resp.destinyMemberships ?? [];
  if (list.length === 0) {
    throw new Error("Aucun compte Destiny lié à ce compte Bungie.");
  }
  const primary = resp.primaryMembershipId
    ? list.find((m) => m.membershipId === resp.primaryMembershipId) ?? list[0]
    : list[0];

  const displayName =
    resp.bungieNetUser?.uniqueName ??
    primary.bungieGlobalDisplayName ??
    primary.displayName ??
    "Gardien";

  return {
    membershipType: primary.membershipType,
    membershipId: primary.membershipId,
    displayName,
  };
}
