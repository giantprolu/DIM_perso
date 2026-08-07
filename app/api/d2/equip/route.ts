import { NextRequest, NextResponse } from "next/server";
import { bungiePost } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

interface EquipResults {
  equipResults?: { itemInstanceId: string; equipStatus: number }[];
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    itemIds?: string[];
    characterId?: string;
  } | null;

  if (!body?.itemIds?.length || !body.characterId) {
    return NextResponse.json({ error: "paramètres manquants" }, { status: 400 });
  }

  try {
    const resp = await bungiePost<EquipResults>(
      "/Destiny2/Actions/Items/EquipItems/",
      {
        itemIds: body.itemIds,
        characterId: body.characterId,
        membershipType: ctx.mem.t,
      },
      ctx.access
    );
    return withRefreshedCookies(
      NextResponse.json({ ok: true, results: resp.equipResults ?? [] }),
      ctx
    );
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "Erreur Bungie" },
        { status: 502 }
      ),
      ctx
    );
  }
}
