import { NextResponse } from "next/server";
import { COOKIE_STATE, cookieOpts } from "@/lib/auth-cookies";

export async function GET(request: Request) {
  const clientId = process.env.BUNGIE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "BUNGIE_CLIENT_ID manquant — configure tes variables d'environnement (voir README)." },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  const url = new URL("https://www.bungie.net/en/OAuth/Authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set(COOKIE_STATE, state, cookieOpts(600));
  return res;
}
