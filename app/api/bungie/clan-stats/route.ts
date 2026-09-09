import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { AccountHistoricalStats } from "@/lib/types";

/**
 * Les compteurs de carrière de chaque membre du clan, pour se situer.
 *
 * Une comparaison faite depuis le navigateur aurait lancé une requête par
 * membre — cinquante allers-retours, cinquante fois le coût du cookie et de
 * l'authentification. On la fait ici, par paquets, et on ne renvoie que les
 * quelques nombres qui servent réellement au classement.
 *
 * Un profil privé n'est pas une erreur : Bungie renvoie simplement des
 * statistiques vides. Ces membres sont marqués « privé » plutôt qu'écartés en
 * silence, sinon un clan à moitié privé donne un classement mensonger.
 */

/** Membres interrogés simultanément. Au-delà, Bungie limite le débit. */
const BATCH = 6;
/** Plafond de sécurité : un clan plafonne à cent membres. */
const MAX_MEMBERS = 100;

interface RosterMember {
  destinyUserInfo?: {
    membershipId?: string;
    membershipType?: number;
    displayName?: string;
    bungieGlobalDisplayName?: string;
    bungieGlobalDisplayNameCode?: number;
    iconPath?: string;
    crossSaveOverride?: number;
  };
  isOnline?: boolean;
  joinDate?: string;
}

export interface ClanMemberStats {
  membershipId: string;
  membershipType: number;
  name: string;
  code?: number;
  icon?: string;
  isOnline: boolean;
  /** Bungie n'a rien renvoyé : profil restreint par son propriétaire. */
  private: boolean;
  /** Le membre connecté, pour se repérer dans le classement. */
  isMe: boolean;
  secondsPlayed: number;
  activitiesCleared: number;
  kills: number;
  deaths: number;
  killsDeathsRatio: number;
  efficiency: number;
  pvpKills: number;
  pvpWins: number;
  raidClears: number;
}

function num(
  stats: AccountHistoricalStats | null,
  group: string,
  key: string
): number {
  const value =
    stats?.mergedAllCharacters?.results?.[group]?.allTime?.[key]?.basic?.value;
  return typeof value === "number" ? value : 0;
}

/** Compte Destiny porteur des personnages (la sauvegarde partagée déplace le compte). */
function account(m: RosterMember): { type: number; id: string } | null {
  const info = m.destinyUserInfo;
  if (!info?.membershipId) return null;
  const type =
    info.crossSaveOverride && info.crossSaveOverride !== 0
      ? info.crossSaveOverride
      : info.membershipType;
  if (type === undefined) return null;
  return { type, id: info.membershipId };
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  try {
    const groups = await bungieGet<{
      results?: { group?: { groupId?: string; name?: string } }[];
    }>(`/GroupV2/User/${ctx.mem.t}/${ctx.mem.i}/0/1/`, ctx.access);

    const group = groups.results?.[0]?.group;
    if (!group?.groupId) {
      return withRefreshedCookies(
        NextResponse.json({ clanName: null, members: [] }),
        ctx
      );
    }

    // Le roster arrive par pages de cinquante.
    const roster: RosterMember[] = [];
    for (let page = 1; page <= 2; page++) {
      const chunk = await bungieGet<{
        results?: RosterMember[];
        hasMore?: boolean;
      }>(`/GroupV2/${group.groupId}/Members/?currentpage=${page}`, ctx.access);
      roster.push(...(chunk.results ?? []));
      if (!chunk.hasMore) break;
    }

    const targets = roster.slice(0, MAX_MEMBERS);
    const members: ClanMemberStats[] = [];

    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      const stats = await Promise.all(
        slice.map((m) => {
          const acc = account(m);
          if (!acc) return Promise.resolve(null);
          return bungieGet<AccountHistoricalStats>(
            `/Destiny2/${acc.type}/Account/${acc.id}/Stats/?groups=1`,
            ctx.access
          ).catch(() => null);
        })
      );

      slice.forEach((m, index) => {
        const acc = account(m);
        if (!acc) return;
        const s = stats[index];
        const info = m.destinyUserInfo;
        const played = num(s, "allPvE", "secondsPlayed") +
          num(s, "allPvP", "secondsPlayed");
        members.push({
          membershipId: acc.id,
          membershipType: acc.type,
          name:
            info?.bungieGlobalDisplayName || info?.displayName || "Gardien",
          code: info?.bungieGlobalDisplayNameCode,
          icon: info?.iconPath,
          isOnline: Boolean(m.isOnline),
          private: s === null,
          isMe: acc.id === ctx.mem.i,
          secondsPlayed: played,
          activitiesCleared:
            num(s, "allPvE", "activitiesCleared") +
            num(s, "allPvP", "activitiesCleared"),
          kills: num(s, "allPvE", "kills") + num(s, "allPvP", "kills"),
          deaths: num(s, "allPvE", "deaths") + num(s, "allPvP", "deaths"),
          killsDeathsRatio: num(s, "allPvP", "killsDeathsRatio"),
          efficiency: num(s, "allPvP", "efficiency"),
          pvpKills: num(s, "allPvP", "kills"),
          pvpWins: num(s, "allPvP", "activitiesWon"),
          raidClears: num(s, "raid", "activitiesCleared"),
        });
      });
    }

    const res = NextResponse.json({ clanName: group.name ?? null, members });
    // Des compteurs de carrière ne bougent pas d'une minute à l'autre.
    res.headers.set("Cache-Control", "private, max-age=300");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
