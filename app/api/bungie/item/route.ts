import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { ItemResponse } from "@/lib/types";

/**
 * Un seul objet, pas tout le profil.
 *
 * Après avoir posé un mod ou équipé une pièce, on ne veut vérifier qu'UNE
 * instance : relire le profil complet coûtait plusieurs mégaoctets et une
 * poignée de secondes pour lire une poignée d'emplacements.
 *
 * 300 instance (puissance, énergie), 304 stats, 305 sockets.
 */
const COMPONENTS = "300,304,305";

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const itemInstanceId = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^\d+$/.test(itemInstanceId)) {
    return NextResponse.json(
      { error: "itemInstanceId manquant" },
      { status: 400 }
    );
  }

  try {
    const item = await bungieGet<ItemResponse>(
      `/Destiny2/${ctx.mem.t}/Profile/${ctx.mem.i}/Item/${itemInstanceId}/?components=${COMPONENTS}`,
      ctx.access
    );
    const res = NextResponse.json(item);
    // Lu juste après une écriture : un cache resservirait l'état d'avant.
    res.headers.set("Cache-Control", "no-store");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
