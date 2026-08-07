import { cookies } from "next/headers";

export const COOKIE_ACCESS = "d2_at";
export const COOKIE_REFRESH = "d2_rt";
export const COOKIE_EXPIRES = "d2_exp";
export const COOKIE_MEMBERSHIP = "d2_mem"; // JSON { t, i, n }
export const COOKIE_STATE = "d2_state";

export interface MembershipCookie {
  /** membershipType Destiny (1 Xbox, 2 PSN, 3 Steam, 6 Epic…) */
  t: number;
  /** destinyMembershipId */
  i: string;
  /** displayName */
  n: string;
}

export function cookieOpts(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Lecture des cookies d'auth côté serveur (route handlers / RSC). */
export async function readAuthCookies() {
  const jar = await cookies();
  const at = jar.get(COOKIE_ACCESS)?.value ?? null;
  const rt = jar.get(COOKIE_REFRESH)?.value ?? null;
  const exp = Number(jar.get(COOKIE_EXPIRES)?.value ?? 0);
  let mem: MembershipCookie | null = null;
  const raw = jar.get(COOKIE_MEMBERSHIP)?.value;
  if (raw) {
    try {
      mem = JSON.parse(raw) as MembershipCookie;
    } catch {
      mem = null;
    }
  }
  return { at, rt, exp, mem };
}
