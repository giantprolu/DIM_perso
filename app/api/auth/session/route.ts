import { NextResponse } from "next/server";
import { readAuthCookies } from "@/lib/auth-cookies";

export async function GET() {
  const { at, rt, mem } = await readAuthCookies();
  if ((!at && !rt) || !mem) {
    return NextResponse.json({ loggedIn: false });
  }
  return NextResponse.json({ loggedIn: true, displayName: mem.n });
}
