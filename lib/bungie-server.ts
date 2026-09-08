/**
 * Client Bungie côté serveur uniquement.
 * L'API key et le client secret ne quittent jamais le serveur.
 */

const PLATFORM = "https://www.bungie.net/Platform";

/** Au-delà, on considère que Bungie ne répondra pas. */
const TIMEOUT_MS = 20_000;
/** Une requête throttlée ou tombée sur une erreur serveur est rejouée. */
const MAX_ATTEMPTS = 3;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name} (voir README)`);
  return v;
}

/**
 * Erreur Bungie exploitable : on garde le code machine (`ErrorCode`) en plus
 * du message, pour que l'appelant distingue « profil privé », « maintenance »
 * et « vraie panne » au lieu d'afficher partout « Erreur Bungie ».
 */
export class BungieApiError extends Error {
  readonly errorCode: number;
  readonly errorStatus: string;
  readonly httpStatus: number;
  readonly throttleSeconds: number;

  constructor(opts: {
    message: string;
    errorCode: number;
    errorStatus?: string;
    httpStatus: number;
    throttleSeconds?: number;
  }) {
    super(opts.message);
    this.name = "BungieApiError";
    this.errorCode = opts.errorCode;
    this.errorStatus = opts.errorStatus ?? "";
    this.httpStatus = opts.httpStatus;
    this.throttleSeconds = opts.throttleSeconds ?? 0;
  }

  /** Le compte visé garde ses données pour lui : ce n'est pas une panne. */
  get isPrivate(): boolean {
    return this.errorCode === 1665;
  }

  /** Statut HTTP à renvoyer à notre propre client. */
  get status(): number {
    if (this.errorCode === 99 || this.errorCode === 12) return 401;
    if (this.isPrivate) return 403;
    if (this.errorCode === 1601 || this.errorCode === 21) return 404;
    if (isThrottleCode(this.errorCode) || this.httpStatus === 429) return 429;
    return 502;
  }
}

/** Codes de limitation de débit : la requête est légitime, juste trop tôt. */
const THROTTLE_CODES = new Set([31, 35, 36, 37, 51, 54, 55, 56, 57]);

function isThrottleCode(code: number): boolean {
  return THROTTLE_CODES.has(code);
}

/**
 * Codes qu'on sait traduire. Le reste retombe sur le message de Bungie : il
 * est en anglais, mais reste plus utile qu'un « erreur inconnue ».
 */
const FRIENDLY: Record<number, string> = {
  5: "L'API Bungie est en maintenance (elle ferme à chaque reset hebdomadaire). Réessaie dans un moment.",
  12: "Ton autorisation Bungie ne couvre pas cette action : déconnecte-toi puis reconnecte-toi pour re-consentir.",
  99: "Session Bungie expirée : reconnecte-toi.",
  622: "Clan introuvable.",
  686: "Clan introuvable.",
  1601: "Aucun compte Destiny lié à ce profil.",
  1618: "Compte Destiny introuvable sur cette plateforme.",
  1627: "Ce marchand n'est pas disponible en ce moment.",
  1665: "Ce profil est privé : son propriétaire a restreint l'accès à ses données Destiny.",
  1670: "Compte de plateforme inaccessible (cross-save ?).",
};

function friendlyMessage(code: number, raw: string | undefined): string {
  if (FRIENDLY[code]) return FRIENDLY[code];
  if (isThrottleCode(code)) {
    return "L'API Bungie limite le débit : patiente quelques secondes puis réessaie.";
  }
  return raw && raw.trim()
    ? `API Bungie : ${raw}`
    : "L'API Bungie n'a pas répondu correctement.";
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BungieEnvelope<T> {
  ErrorCode?: number;
  ErrorStatus?: string;
  Message?: string;
  ThrottleSeconds?: number;
  Response?: T;
}

/** Délai avant rejeu : celui que Bungie impose, sinon un back-off simple. */
function retryDelay(lastError: unknown, attempt: number): number {
  if (lastError instanceof BungieApiError && lastError.throttleSeconds > 0) {
    // Bungie compte parfois en dizaines de secondes : on plafonne pour ne pas
    // immobiliser une requête HTTP entière.
    return Math.min(lastError.throttleSeconds * 1000, 5_000);
  }
  return 400 * 2 ** (attempt - 1);
}

/**
 * Appel Platform avec rejeu automatique.
 *
 * On ne rejoue que ce qui a une chance d'aboutir : throttling (Bungie donne
 * lui-même le délai dans `ThrottleSeconds`), erreurs serveur et coupures
 * réseau. Une erreur métier (profil privé, privilèges) remonte immédiatement.
 */
async function bungieRequest<T>(
  path: string,
  init: RequestInit,
  accessToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "X-API-Key": env("BUNGIE_API_KEY"),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(retryDelay(lastError, attempt));

    let res: Response;
    try {
      res = await fetch(`${PLATFORM}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Coupure réseau ou délai dépassé : ça vaut la peine de réessayer.
      lastError = new BungieApiError({
        message: "L'API Bungie n'a pas répondu (réseau ou délai dépassé).",
        errorCode: 0,
        httpStatus: 0,
      });
      continue;
    }

    const json = (await res.json().catch(() => null)) as BungieEnvelope<T> | null;
    const code = json?.ErrorCode ?? 0;

    if (res.ok && json && code === 1 && json.Response !== undefined) {
      return json.Response;
    }

    const error = new BungieApiError({
      message: friendlyMessage(code, json?.Message),
      errorCode: code,
      errorStatus: json?.ErrorStatus,
      httpStatus: res.status,
      throttleSeconds: json?.ThrottleSeconds,
    });

    const retryable = isThrottleCode(code) || res.status === 429 || res.status >= 500;
    if (!retryable) throw error;
    lastError = error;
  }

  throw lastError instanceof Error
    ? lastError
    : new BungieApiError({
        message: "L'API Bungie n'a pas répondu.",
        errorCode: 0,
        httpStatus: 0,
      });
}

/** GET sur l'API Platform. Lève une BungieApiError si ErrorCode !== 1. */
export function bungieGet<T>(path: string, accessToken?: string): Promise<T> {
  return bungieRequest<T>(path, { method: "GET" }, accessToken);
}

/** POST authentifié sur l'API Platform. Lève une BungieApiError si ErrorCode !== 1. */
export function bungiePost<T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  return bungieRequest<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    accessToken
  );
}

/** Statut HTTP à renvoyer au navigateur pour une erreur remontée d'ici. */
export function errorStatus(e: unknown): number {
  return e instanceof BungieApiError ? e.status : 502;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Erreur Bungie";
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

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

/*
 * Les refresh tokens Bungie sont à usage unique : un renouvellement en émet un
 * nouveau et périme l'ancien. Or nos pages lancent plusieurs requêtes en
 * parallèle, toutes porteuses du MÊME cookie (le navigateur n'a pas encore reçu
 * le Set-Cookie de la première). Sans mémoire partagée, la deuxième requête
 * échangeait un token déjà consommé et déconnectait l'utilisateur au hasard.
 *
 * On garde donc, pour chaque ancien token : l'échange en cours — les requêtes
 * simultanées partagent la même promesse — puis son résultat pendant une
 * minute, le temps que les requêtes en retard réutilisent le nouveau jeu.
 */
const refreshInFlight = new Map<string, Promise<TokenResponse>>();
const refreshRecent = new Map<string, { at: number; tokens: TokenResponse }>();
const REFRESH_MEMORY_MS = 60_000;

function rememberRefresh(oldToken: string, tokens: TokenResponse): void {
  const now = Date.now();
  for (const [key, entry] of refreshRecent) {
    if (now - entry.at > REFRESH_MEMORY_MS) refreshRecent.delete(key);
  }
  refreshRecent.set(oldToken, { at: now, tokens });
}

export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const recent = refreshRecent.get(refreshToken);
  if (recent && Date.now() - recent.at < REFRESH_MEMORY_MS) {
    return Promise.resolve(recent.tokens);
  }

  const running = refreshInFlight.get(refreshToken);
  if (running) return running;

  const promise = tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  )
    .then((tokens) => {
      rememberRefresh(refreshToken, tokens);
      return tokens;
    })
    .finally(() => refreshInFlight.delete(refreshToken));

  refreshInFlight.set(refreshToken, promise);
  return promise;
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
