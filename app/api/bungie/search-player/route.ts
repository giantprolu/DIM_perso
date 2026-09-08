import { NextRequest, NextResponse } from "next/server";
import { bungiePost, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { PlayerSearchResult, UserInfoCard } from "@/lib/types";

/**
 * Recherche d'un Gardien par nom Bungie, pour inspecter n'importe quel joueur
 * et pas seulement les membres du clan.
 *
 * Deux façons de chercher, selon ce qui est tapé :
 *  - « Nom#1234 » → SearchDestinyPlayerByBungieName, correspondance exacte ;
 *  - « Nom »      → SearchByGlobalNamePost, recherche par préfixe.
 *
 * Un compte Bungie peut porter plusieurs comptes Destiny (cross-save) : on ne
 * garde que celui qui fait foi, sinon le même joueur apparaît trois fois.
 */

/** membershipType -1 = toutes plateformes. */
const ALL_PLATFORMS = -1;
const MAX_RESULTS = 20;

interface GlobalNameSearchResponse {
  searchResults?: {
    bungieGlobalDisplayName?: string;
    bungieGlobalDisplayNameCode?: number;
    destinyMemberships?: UserInfoCard[];
  }[];
  hasMore?: boolean;
}

/**
 * Compte à interroger pour un joueur cross-save : celui désigné par
 * `crossSaveOverride`, sinon l'unique compte connu.
 */
function primaryMembership(list: UserInfoCard[]): UserInfoCard | null {
  if (list.length === 0) return null;
  const override = list.find(
    (m) => m.crossSaveOverride && m.crossSaveOverride === m.membershipType
  );
  return override ?? list[0];
}

function toResult(
  membership: UserInfoCard,
  name: string | undefined,
  code: number | undefined
): PlayerSearchResult {
  return {
    membershipType: membership.membershipType,
    membershipId: membership.membershipId,
    name:
      name ??
      membership.bungieGlobalDisplayName ??
      membership.displayName ??
      "Gardien",
    code: code ?? membership.bungieGlobalDisplayNameCode,
    icon: membership.iconPath,
    platforms: membership.applicableMembershipTypes ?? [membership.membershipType],
  };
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 3) {
    return NextResponse.json(
      { error: "Tape au moins 3 caractères." },
      { status: 400 }
    );
  }

  const exact = query.match(/^(.+)#(\d{1,5})$/);

  try {
    const results: PlayerSearchResult[] = [];

    if (exact) {
      const memberships = await bungiePost<UserInfoCard[]>(
        `/Destiny2/SearchDestinyPlayerByBungieName/${ALL_PLATFORMS}/`,
        { displayName: exact[1], displayNameCode: Number(exact[2]) },
        ctx.access
      );
      const primary = primaryMembership(memberships ?? []);
      if (primary) {
        results.push(toResult(primary, exact[1], Number(exact[2])));
      }
    } else {
      const found = await bungiePost<GlobalNameSearchResponse>(
        "/User/Search/GlobalName/0/",
        { displayNamePrefix: query },
        ctx.access
      );
      for (const entry of found.searchResults ?? []) {
        const primary = primaryMembership(entry.destinyMemberships ?? []);
        if (!primary) continue; // compte Bungie sans Destiny : rien à montrer
        results.push(
          toResult(
            primary,
            entry.bungieGlobalDisplayName,
            entry.bungieGlobalDisplayNameCode
          )
        );
        if (results.length >= MAX_RESULTS) break;
      }
    }

    const res = NextResponse.json({ results });
    res.headers.set("Cache-Control", "private, max-age=60");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
