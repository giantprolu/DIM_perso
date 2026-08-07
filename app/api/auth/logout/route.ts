import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_ACCESS,
  COOKIE_EXPIRES,
  COOKIE_MEMBERSHIP,
  COOKIE_REFRESH,
  cookieOpts,
} from "@/lib/auth-cookies";

export async function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/", request.url));
  for (const name of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_EXPIRES, COOKIE_MEMBERSHIP]) {
    res.cookies.set(name, "", cookieOpts(0));
  }
  return res;
}
