import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getPrimaryDestinyMembership } from "@/lib/bungie-server";
import {
  COOKIE_ACCESS,
  COOKIE_EXPIRES,
  COOKIE_MEMBERSHIP,
  COOKIE_REFRESH,
  COOKIE_STATE,
  cookieOpts,
} from "@/lib/auth-cookies";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(COOKIE_STATE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?error=oauth_state", request.url));
  }

  try {
    const tokens = await exchangeCode(code);
    const membership = await getPrimaryDestinyMembership(tokens.access_token);

    const res = NextResponse.redirect(new URL("/", request.url));
    const refreshTtl = tokens.refresh_expires_in;

    res.cookies.set(COOKIE_ACCESS, tokens.access_token, cookieOpts(tokens.expires_in));
    res.cookies.set(COOKIE_REFRESH, tokens.refresh_token, cookieOpts(refreshTtl));
    res.cookies.set(
      COOKIE_EXPIRES,
      String(Date.now() + tokens.expires_in * 1000),
      cookieOpts(refreshTtl)
    );
    res.cookies.set(
      COOKIE_MEMBERSHIP,
      JSON.stringify({
        t: membership.membershipType,
        i: membership.membershipId,
        n: membership.displayName,
      }),
      cookieOpts(refreshTtl)
    );
    res.cookies.set(COOKIE_STATE, "", cookieOpts(0));
    return res;
  } catch (e) {
    console.error("Callback OAuth :", e);
    return NextResponse.redirect(new URL("/?error=oauth_exchange", request.url));
  }
}
