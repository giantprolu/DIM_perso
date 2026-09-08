import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";

/**
 * Clan du joueur et son roster.
 * groupType 1 = Clan, filter 0 = tous les groupes.
 */

/** Réponse paginée de GroupV2 (le roster arrive par pages de 50). */
interface MemberPage {
  results?: unknown[];
  hasMore?: boolean;
  totalResults?: number;
}

/** Garde-fou : un clan plafonne à 100 membres, 10 pages sont largement de trop. */
const MAX_PAGES = 10;

/**
 * Récupère TOUTES les pages du roster.
 *
 * Bungie sert 50 membres par page : s'arrêter à la première coupait la moitié
 * d'un clan plein en deux sans le dire.
 */
async function fetchAllMembers(groupId: string, access: string) {
  const results: unknown[] = [];
  let page = 1;
  let last: MemberPage = {};

  while (page <= MAX_PAGES) {
    const chunk = await bungieGet<MemberPage>(
      `/GroupV2/${groupId}/Members/?currentpage=${page}`,
      access
    );
    last = chunk;
    const batch = chunk.results ?? [];
    results.push(...batch);
    if (!chunk.hasMore || batch.length === 0) break;
    page++;
  }

  return { ...last, results, totalResults: results.length };
}

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
      fetchAllMembers(groupId, ctx.access),
    ]);

    return withRefreshedCookies(NextResponse.json({ detail, members }), ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
