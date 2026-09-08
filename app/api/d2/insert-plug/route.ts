import { NextRequest, NextResponse } from "next/server";
import { bungiePost } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { SocketState } from "@/lib/types";

/**
 * Réponse de `InsertSocketPlugFree` (DestinyItemChangeResponse).
 *
 * Bungie y renvoie l'objet APRÈS modification : c'est la seule source de
 * vérité immédiate. Relire le profil juste après échoue régulièrement
 * (réplication côté Bungie + cache HTTP) et faisait passer pour « non posé »
 * un mod pourtant bien en place.
 */
interface ItemChangeResponse {
  item?: {
    sockets?: { data?: { sockets?: SocketState[] } };
  };
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    itemId?: string;
    characterId?: string;
    socketIndex?: number;
    plugItemHash?: number;
  } | null;

  if (
    !body?.itemId ||
    !body.characterId ||
    body.socketIndex === undefined ||
    !body.plugItemHash
  ) {
    return NextResponse.json({ error: "paramètres manquants" }, { status: 400 });
  }

  try {
    const changed = await bungiePost<ItemChangeResponse>(
      "/Destiny2/Actions/Items/InsertSocketPlugFree/",
      {
        plug: {
          socketIndex: body.socketIndex,
          socketArrayType: 0,
          plugItemHash: body.plugItemHash,
        },
        itemId: body.itemId,
        characterId: body.characterId,
        membershipType: ctx.mem.t,
      },
      ctx.access
    );

    const sockets = changed?.item?.sockets?.data?.sockets ?? null;
    const actual = sockets?.[body.socketIndex]?.plugHash ?? null;

    const res = NextResponse.json({
      ok: true,
      /** null quand Bungie n'a pas renvoyé l'objet : on ne peut alors rien affirmer */
      applied: sockets ? actual === body.plugItemHash : null,
      actualPlugHash: actual,
      sockets,
    });
    res.headers.set("Cache-Control", "no-store");
    return withRefreshedCookies(res, ctx);
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
