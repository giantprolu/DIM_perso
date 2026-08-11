import { NextRequest, NextResponse } from "next/server";
import { bungieGet } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

/**
 * Clan du joueur et son roster.
 * groupType 1 = Clan, filter 0 = tous les groupes.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  try {
    const groups = (await bungieGet(
      `/GroupV2/User/${ctx.mem.t}/${ctx.mem.i}/0/1/`,
      ctx.access
    )) as {
      results?: { group?: { groupId?: string } }[];
    };

    const groupId = groups.results?.[0]?.group?.groupId;
    if (!groupId) {
      return withRefreshedCookies(
        NextResponse.json({ clan: null, members: [] }),
        ctx
      );
    }

    const [detail, members] = await Promise.all([
      bungieGet(`/GroupV2/${groupId}/`, ctx.access),
      bungieGet(`/GroupV2/${groupId}/Members/?currentpage=1`, ctx.access),
    ]);

    return withRefreshedCookies(
      NextResponse.json({ detail, members }),
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
