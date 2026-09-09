import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type {
  ActivityHistoryPage,
  ProfileResponse,
  PublicMilestone,
} from "@/lib/types";

/**
 * Tout ce qu'un tableau de bord doit savoir, en un seul aller-retour.
 *
 * Le profil couvre l'essentiel :
 *   100 identité et rang de Gardien      103 devises
 *   104 artefact (vu du compte)          200 personnages
 *   201 inventaires (poursuites, postes) 202 jalons, réputations, saison
 *   204 ce que fait chaque personnage    205 équipement porté
 *   300 puissance de chaque instance     1200 variables des libellés
 *
 * S'y ajoutent la rotation publique et les dernières parties de chaque
 * personnage : sans elles, la page devrait enchaîner quatre requêtes côté
 * navigateur avant d'afficher quoi que ce soit.
 */
const COMPONENTS = "100,103,104,200,201,202,204,205,300,1200";

/** Assez pour un fil « ce que tu viens de jouer », pas assez pour peser. */
const RECENT_PER_CHARACTER = 5;

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  try {
    const profile = await bungieGet<ProfileResponse>(
      `/Destiny2/${ctx.mem.t}/Profile/${ctx.mem.i}/?components=${COMPONENTS}`,
      ctx.access
    );

    const characterIds = Object.keys(profile.characters?.data ?? {});
    const base = `/Destiny2/${ctx.mem.t}/Account/${ctx.mem.i}`;

    // La rotation publique et l'historique sont des bonus : leur absence ne
    // doit pas priver l'utilisateur de son propre profil.
    const [publicMilestones, ...histories] = await Promise.all([
      bungieGet<Record<string, PublicMilestone>>("/Destiny2/Milestones/").catch(
        () => null
      ),
      ...characterIds.map((id) =>
        bungieGet<ActivityHistoryPage>(
          `${base}/Character/${id}/Stats/Activities/?count=${RECENT_PER_CHARACTER}&page=0&mode=0`,
          ctx.access
        ).catch(() => null)
      ),
    ]);

    const recent: Record<string, ActivityHistoryPage> = {};
    characterIds.forEach((id, i) => {
      const page = histories[i];
      if (page) recent[id] = page;
    });

    const res = NextResponse.json({ profile, publicMilestones, recent });
    // Puissance, primes et maître des postes changent à chaque partie.
    res.headers.set("Cache-Control", "no-store");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
