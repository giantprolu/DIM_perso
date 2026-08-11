import { NextRequest, NextResponse } from "next/server";
import { bungiePost } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

/**
 * Pointer/dépointer une quête (SetTrackedState) ou verrouiller/déverrouiller
 * un objet (SetLockState). Ce sont les deux seules actions « d'état »
 * exposées par Bungie.
 */
const ENDPOINTS = {
  track: "/Destiny2/Actions/Items/SetTrackedState/",
  lock: "/Destiny2/Actions/Items/SetLockState/",
} as const;

export async function POST(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    action?: keyof typeof ENDPOINTS;
    state?: boolean;
    itemId?: string;
    characterId?: string;
  } | null;

  if (
    !body?.action ||
    !(body.action in ENDPOINTS) ||
    typeof body.state !== "boolean" ||
    !body.itemId ||
    !body.characterId
  ) {
    return NextResponse.json({ error: "paramètres manquants" }, { status: 400 });
  }

  try {
    await bungiePost(
      ENDPOINTS[body.action],
      {
        state: body.state,
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
