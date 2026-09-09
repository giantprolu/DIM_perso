import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type {
  ActivityHistoryPage,
  PostGameCarnageReport,
  WeaponUsage,
} from "@/lib/types";

/**
 * Toutes les armes réellement utilisées, et pas seulement les exotiques.
 *
 * `GetUniqueWeaponHistory` — la seule statistique d'armes que Bungie tienne à
 * vie — ne compte que les exotiques : c'est pour cela que l'onglet Armes
 * n'affichait qu'une poignée de lignes. Le détail complet existe pourtant,
 * mais partie par partie, dans `extended.weapons` de chaque rapport de fin de
 * partie. On relit donc les dernières parties et on additionne.
 *
 * Le coût est une requête par partie : on plafonne, on parallélise par
 * paquets, et on tolère les rapports illisibles (une partie très ancienne peut
 * ne plus avoir de rapport).
 */

/** Parties relues au maximum. Au-delà, l'attente n'en vaut plus la peine. */
const MAX_GAMES = 40;
/** Rapports demandés en même temps : au-delà, Bungie limite le débit. */
const BATCH = 8;

interface AggregatedWeapon {
  itemHash: number;
  kills: number;
  precisionKills: number;
  games: number;
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const characterId = params.get("characterId") ?? "";
  const count = clamp(Number(params.get("count") ?? 25), 5, MAX_GAMES);

  if (!/^\d+$/.test(characterId)) {
    return NextResponse.json({ error: "characterId manquant" }, { status: 400 });
  }

  const base = `/Destiny2/${ctx.mem.t}/Account/${ctx.mem.i}`;

  try {
    const history = await bungieGet<ActivityHistoryPage>(
      `${base}/Character/${characterId}/Stats/Activities/?count=${count}&page=0&mode=0`,
      ctx.access
    );
    const ids = (history.activities ?? [])
      .map((a) => a.activityDetails.instanceId)
      .filter(Boolean);

    const totals = new Map<number, AggregatedWeapon>();
    let readGames = 0;
    let oldest: string | undefined;

    for (let i = 0; i < ids.length; i += BATCH) {
      const reports = await Promise.all(
        ids.slice(i, i + BATCH).map((id) =>
          bungieGet<PostGameCarnageReport>(
            `/Destiny2/Stats/PostGameCarnageReport/${id}/`,
            ctx.access
          ).catch(() => null)
        )
      );

      for (const report of reports) {
        if (!report) continue;
        readGames++;
        if (!oldest || report.period < oldest) oldest = report.period;

        // Un rapport contient toute l'équipe : on ne garde que nos lignes.
        const mine = (report.entries ?? []).filter(
          (e) => e.characterId === characterId
        );
        for (const entry of mine) {
          for (const weapon of entry.extended?.weapons ?? []) {
            addWeapon(totals, weapon);
          }
        }
      }
    }

    const weapons = [...totals.values()].sort((a, b) => b.kills - a.kills);
    const res = NextResponse.json({ weapons, games: readGames, since: oldest });
    // Des parties terminées ne changent plus : une minute suffit à éviter les
    // rechargements en rafale sans jamais servir de données mortes.
    res.headers.set("Cache-Control", "private, max-age=60");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}

function addWeapon(
  totals: Map<number, AggregatedWeapon>,
  weapon: WeaponUsage
): void {
  const kills = weapon.values?.uniqueWeaponKills?.basic?.value ?? 0;
  if (kills <= 0) return;
  const precision =
    weapon.values?.uniqueWeaponPrecisionKills?.basic?.value ?? 0;
  const current = totals.get(weapon.referenceId) ?? {
    itemHash: weapon.referenceId,
    kills: 0,
    precisionKills: 0,
    games: 0,
  };
  current.kills += kills;
  current.precisionKills += precision;
  current.games += 1;
  totals.set(weapon.referenceId, current);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
