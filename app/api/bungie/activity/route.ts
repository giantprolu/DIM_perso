import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type {
  AccountHistoricalStats,
  ActivityHistoryPage,
  AggregateActivityResults,
  PostGameCarnageReport,
  UniqueWeaponResults,
} from "@/lib/types";

/**
 * Historique et statistiques — la partie « ce que tu as joué » de l'API,
 * jusqu'ici inexploitée par le site.
 *
 *  history   GetActivityHistory              activités récentes d'un personnage
 *  pgcr      GetPostGameCarnageReport        le détail d'une de ces parties
 *  stats     GetHistoricalStatsForAccount    compteurs de carrière du compte
 *  weapons   GetUniqueWeaponHistory          éliminations par arme
 *  aggregate GetDestinyAggregateActivityStats complétions par activité
 *
 * Ces données sont figées (une partie terminée ne change plus) : on autorise
 * un cache navigateur court, contrairement au profil.
 */
type Kind = "history" | "pgcr" | "stats" | "weapons" | "aggregate";

const KINDS: Kind[] = ["history", "pgcr", "stats", "weapons", "aggregate"];

/** Le PGCR d'une partie ne bougera plus jamais : autant le garder. */
const CACHE_IMMUTABLE = "private, max-age=3600";
const CACHE_SHORT = "private, max-age=60";

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const kind = (params.get("kind") ?? "history") as Kind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind inconnu" }, { status: 400 });
  }

  const characterId = params.get("characterId") ?? "";
  const needsCharacter = kind === "history" || kind === "weapons" || kind === "aggregate";
  if (needsCharacter && !/^\d+$/.test(characterId)) {
    return NextResponse.json({ error: "characterId manquant" }, { status: 400 });
  }

  const base = `/Destiny2/${ctx.mem.t}/Account/${ctx.mem.i}`;

  try {
    let data: unknown;
    let cache = CACHE_SHORT;

    switch (kind) {
      case "history": {
        // count plafonné : au-delà, Bungie renvoie une réponse énorme pour rien.
        const count = clamp(Number(params.get("count") ?? 25), 1, 100);
        const page = clamp(Number(params.get("page") ?? 0), 0, 100);
        const mode = clamp(Number(params.get("mode") ?? 0), 0, 100);
        data = await bungieGet<ActivityHistoryPage>(
          `${base}/Character/${characterId}/Stats/Activities/?count=${count}&page=${page}&mode=${mode}`,
          ctx.access
        );
        break;
      }
      case "pgcr": {
        const activityId = params.get("activityId") ?? "";
        if (!/^\d+$/.test(activityId)) {
          return NextResponse.json(
            { error: "activityId manquant" },
            { status: 400 }
          );
        }
        data = await bungieGet<PostGameCarnageReport>(
          `/Destiny2/Stats/PostGameCarnageReport/${activityId}/`,
          ctx.access
        );
        cache = CACHE_IMMUTABLE;
        break;
      }
      case "stats":
        // groups 1 General, 2 Weapons, 3 Medals
        data = await bungieGet<AccountHistoricalStats>(
          `${base}/Stats/?groups=1,2`,
          ctx.access
        );
        break;
      case "weapons":
        data = await bungieGet<UniqueWeaponResults>(
          `${base}/Character/${characterId}/Stats/UniqueWeapons/`,
          ctx.access
        );
        break;
      case "aggregate":
        data = await bungieGet<AggregateActivityResults>(
          `${base}/Character/${characterId}/Stats/AggregateActivityStats/`,
          ctx.access
        );
        break;
    }

    const res = NextResponse.json(data);
    res.headers.set("Cache-Control", cache);
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
