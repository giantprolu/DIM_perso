import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

/**
 * Stock des marchands pour un personnage.
 * 400 marchands (dont la localisation du jour), 401 catégories,
 * 402 ventes, 300/304/305 caractéristiques des objets vendus.
 */
const COMPONENTS = "400,401,402,300,304,305";

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const characterId = request.nextUrl.searchParams.get("characterId");
  if (!characterId) {
    return NextResponse.json({ error: "characterId manquant" }, { status: 400 });
  }

  try {
    const data = await bungieGet(
      `/Destiny2/${ctx.mem.t}/Profile/${ctx.mem.i}/Character/${characterId}/Vendors/?components=${COMPONENTS}`,
      ctx.access
    );
    return withRefreshedCookies(NextResponse.json(data), ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
