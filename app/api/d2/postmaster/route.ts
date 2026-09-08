import { NextRequest, NextResponse } from "next/server";
import { bungiePost, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

/**
 * Récupère un objet au maître des postes.
 * Bungie exige itemReferenceHash + characterId ; itemId n'existe que pour
 * les objets instanciés (armes, armures), pas pour les stacks de matériaux.
 */
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    itemReferenceHash?: number;
    itemId?: string;
    characterId?: string;
    stackSize?: number;
  } | null;

  if (!body?.itemReferenceHash || !body.characterId) {
    return NextResponse.json({ error: "paramètres manquants" }, { status: 400 });
  }

  try {
    await bungiePost(
      "/Destiny2/Actions/Items/PullFromPostmaster/",
      {
        itemReferenceHash: body.itemReferenceHash,
        stackSize: body.stackSize ?? 1,
        itemId: body.itemId ?? "0",
        characterId: body.characterId,
        membershipType: ctx.mem.t,
      },
      ctx.access
    );
    return withRefreshedCookies(NextResponse.json({ ok: true }), ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
