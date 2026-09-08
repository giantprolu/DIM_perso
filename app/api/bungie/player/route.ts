import { NextRequest, NextResponse } from "next/server";
import { bungieGet } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { ProfileResponse } from "@/lib/types";

/**
 * Profil d'un AUTRE joueur (un membre du clan).
 *
 * Bungie n'échoue pas sur un profil restreint : il renvoie le composant avec
 * `privacy: 2` et sans `data`. C'est donc au client de dire « profil privé »
 * plutôt que « erreur ». On demande le strict nécessaire pour une fiche :
 *
 *  100 profil (dernière connexion, identité)   200 personnages
 *  204 activité en cours                       205 équipement porté
 *  300 instances (puissance)                   304 stats des objets
 *  305 sockets (perks et mods visibles)
 */
const COMPONENTS = "100,200,204,205,300,304,305";

/** Statistiques historiques du compte : souvent publiques même si le profil ne l'est pas. */
interface HistoricalAccountStats {
  mergedAllCharacters?: {
    results?: Record<
      string,
      { allTime?: Record<string, { basic?: { value?: number; displayValue?: string } }> }
    >;
  };
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  const type = request.nextUrl.searchParams.get("type");
  const id = request.nextUrl.searchParams.get("id");
  // Une fiche « légère » (survol) se contente des personnages : deux fois
  // moins de données, et pas d'appel aux statistiques historiques.
  const light = request.nextUrl.searchParams.get("light") === "1";

  if (!type || !id || !/^\d+$/.test(type) || !/^\d+$/.test(id)) {
    return NextResponse.json(
      { error: "membershipType et membershipId requis" },
      { status: 400 }
    );
  }

  try {
    const components = light ? "100,200,204" : COMPONENTS;
    const profilePromise = bungieGet<ProfileResponse>(
      `/Destiny2/${type}/Profile/${id}/?components=${components}`,
      ctx.access
    );

    // Les stats de compte sont un bonus : leur absence ne doit rien casser.
    const statsPromise = light
      ? Promise.resolve(null)
      : bungieGet<HistoricalAccountStats>(
          `/Destiny2/${type}/Account/${id}/Stats/?groups=1`,
          ctx.access
        ).catch(() => null);

    const [profile, historical] = await Promise.all([
      profilePromise,
      statsPromise,
    ]);

    const res = NextResponse.json({ profile, historical });
    // Le statut « en ligne » et l'activité en cours changent en permanence.
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
