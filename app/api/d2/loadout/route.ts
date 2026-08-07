import { NextRequest, NextResponse } from "next/server";
import { bungiePost } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

type Action = "snapshot" | "equip" | "clear" | "rename";

const ENDPOINTS: Record<Action, string> = {
  snapshot: "/Destiny2/Actions/Loadouts/SnapshotLoadout/",
  equip: "/Destiny2/Actions/Loadouts/EquipLoadout/",
  clear: "/Destiny2/Actions/Loadouts/ClearLoadout/",
  rename: "/Destiny2/Actions/Loadouts/UpdateLoadoutIdentifiers/",
};

export async function POST(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    action?: Action;
    loadoutIndex?: number;
    characterId?: string;
    colorHash?: number;
    iconHash?: number;
    nameHash?: number;
  } | null;

  if (
    !body?.action ||
    !(body.action in ENDPOINTS) ||
    body.loadoutIndex === undefined ||
    !body.characterId
  ) {
    return NextResponse.json({ error: "paramètres manquants" }, { status: 400 });
  }

  const needsIdentifiers = body.action === "snapshot" || body.action === "rename";
  if (
    needsIdentifiers &&
    (!body.colorHash || !body.iconHash || !body.nameHash)
  ) {
    return NextResponse.json(
      { error: "identifiants de loadout manquants" },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    loadoutIndex: body.loadoutIndex,
    characterId: body.characterId,
    membershipType: ctx.mem.t,
  };
  if (needsIdentifiers) {
    payload.colorHash = body.colorHash;
    payload.iconHash = body.iconHash;
    payload.nameHash = body.nameHash;
  }

  try {
    await bungiePost(ENDPOINTS[body.action], payload, ctx.access);
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
