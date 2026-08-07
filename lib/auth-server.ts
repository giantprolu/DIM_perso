import { NextRequest, NextResponse } from "next/server";
import { refreshTokens, type TokenResponse } from "./bungie-server";
import {
  COOKIE_ACCESS,
  COOKIE_EXPIRES,
  COOKIE_MEMBERSHIP,
  COOKIE_REFRESH,
  cookieOpts,
  type MembershipCookie,
} from "./auth-cookies";

export interface AuthContext {
  access: string;
  mem: MembershipCookie;
  refreshed: TokenResponse | null;
}

/** Lit les cookies, rafraîchit le token si nécessaire. null = non connecté. */
export async function getAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  let access = request.cookies.get(COOKIE_ACCESS)?.value ?? null;
  const refresh = request.cookies.get(COOKIE_REFRESH)?.value ?? null;
  const exp = Number(request.cookies.get(COOKIE_EXPIRES)?.value ?? 0);
  const memRaw = request.cookies.get(COOKIE_MEMBERSHIP)?.value;

  if (!memRaw || (!access && !refresh)) return null;

  let mem: MembershipCookie;
  try {
    mem = JSON.parse(memRaw) as MembershipCookie;
  } catch {
    return null;
  }

  let refreshed: TokenResponse | null = null;
  if ((!access || Date.now() > exp - 60_000) && refresh) {
    try {
      refreshed = await refreshTokens(refresh);
      access = refreshed.access_token;
    } catch {
      return null;
    }
  }
  if (!access) return null;

  return { access, mem, refreshed };
}

/** Reporte les nouveaux tokens sur la réponse si un refresh a eu lieu. */
export function withRefreshedCookies(
  res: NextResponse,
  ctx: AuthContext
): NextResponse {
  if (ctx.refreshed) {
    const ttl = ctx.refreshed.refresh_expires_in;
    res.cookies.set(COOKIE_ACCESS, ctx.refreshed.access_token, cookieOpts(ctx.refreshed.expires_in));
    res.cookies.set(COOKIE_REFRESH, ctx.refreshed.refresh_token, cookieOpts(ttl));
    res.cookies.set(
      COOKIE_EXPIRES,
      String(Date.now() + ctx.refreshed.expires_in * 1000),
      cookieOpts(ttl)
    );
  }
  return res;
}
