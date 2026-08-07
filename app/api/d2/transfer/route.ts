import { NextRequest, NextResponse } from "next/server";
import { bungiePost } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

export async function POST(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    itemReferenceHash?: number;
    itemId?: string;
    transferToVault?: boolean;
    characterId?: string;
    stackSize?: number;
  } | null;

  if (!body?.itemReferenceHash || !body.itemId || !body.characterId) {
    return NextResponse.json({ error: "paramètres manquants" }, { status: 400 });
  }

  try {
    await bungiePost(
      "/Destiny2/Actions/Items/TransferItem/",
      {
        itemReferenceHash: body.itemReferenceHash,
        stackSize: body.stackSize ?? 1,
        transferToVault: Boolean(body.transferToVault),
        itemId: body.itemId,
        characterId: body.characterId,
        membershipType: ctx.mem.t,
      },
      ctx.access
    );
    return withRefreshedCookies(NextResponse.json({ ok: true }), ctx);
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
