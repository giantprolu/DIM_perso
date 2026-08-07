import { NextRequest, NextResponse } from "next/server";
import { bungieGet, refreshTokens, type TokenResponse } from "@/lib/bungie-server";
import {
  COOKIE_ACCESS,
  COOKIE_EXPIRES,
  COOKIE_MEMBERSHIP,
  COOKIE_REFRESH,
  cookieOpts,
  type MembershipCookie,
} from "@/lib/auth-cookies";
import type { ProfileResponse } from "@/lib/types";

/** Composants Bungie par usage, pour ne demander que le nécessaire. */
const SCOPES: Record<string, string> = {
  // 200 personnages, 201 inventaires perso, 301 objectifs d'items
  quests: "200,201,301",
  // 102 coffre, 205 équipé, 300 instances, 304 stats
  gear: "102,200,201,205,300,304",
};

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope") ?? "quests";
  const components = SCOPES[scope];
  if (!components) {
    return NextResponse.json({ error: "scope inconnu" }, { status: 400 });
  }

  let access = request.cookies.get(COOKIE_ACCESS)?.value ?? null;
  const refresh = request.cookies.get(COOKIE_REFRESH)?.value ?? null;
  const exp = Number(request.cookies.get(COOKIE_EXPIRES)?.value ?? 0);
  const memRaw = request.cookies.get(COOKIE_MEMBERSHIP)?.value;

  if (!memRaw || (!access && !refresh)) {
    return NextResponse.json({ error: "non connecté" }, { status: 401 });
  }

  let mem: MembershipCookie;
  try {
    mem = JSON.parse(memRaw) as MembershipCookie;
  } catch {
    return NextResponse.json({ error: "non connecté" }, { status: 401 });
  }

  // Refresh si le token expire dans moins d'une minute
  let refreshed: TokenResponse | null = null;
  if ((!access || Date.now() > exp - 60_000) && refresh) {
    try {
      refreshed = await refreshTokens(refresh);
      access = refreshed.access_token;
    } catch {
      return NextResponse.json({ error: "session expirée" }, { status: 401 });
    }
  }
  if (!access) {
    return NextResponse.json({ error: "non connecté" }, { status: 401 });
  }

  try {
    const profile = await bungieGet<ProfileResponse>(
      `/Destiny2/${mem.t}/Profile/${mem.i}/?components=${components}`,
      access
    );
    const res = NextResponse.json(profile);
    if (refreshed) {
      const ttl = refreshed.refresh_expires_in;
      res.cookies.set(COOKIE_ACCESS, refreshed.access_token, cookieOpts(refreshed.expires_in));
      res.cookies.set(COOKIE_REFRESH, refreshed.refresh_token, cookieOpts(ttl));
      res.cookies.set(COOKIE_EXPIRES, String(Date.now() + refreshed.expires_in * 1000), cookieOpts(ttl));
    }
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur Bungie" },
      { status: 502 }
    );
  }
}
