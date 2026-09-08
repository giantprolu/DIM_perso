import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { ProfileResponse } from "@/lib/types";

/** Composants Bungie par usage, pour ne demander que le nécessaire. */
const SCOPES: Record<string, string> = {
  // 100 profil (saison, rang), 200 personnages, 201 inventaires,
  // 301 objectifs d'items, 900 archives (défis, rangs),
  // 1200 variables de texte (les objectifs affichent « {var:…} » sans elles)
  quests: "100,200,201,301,900,1200",
  // 102 coffre, 205 équipé, 206 loadouts en jeu, 300 instances,
  // 304 stats, 305 sockets
  gear: "102,200,201,205,206,300,304,305",
  // 205 équipé, 310 mods disponibles par emplacement (léger : équipé seul)
  mods: "200,205,300,304,305,310",
  // Perso : équipé + coffre + inventaires, pour proposer les alternatives
  perso: "102,200,201,205,300,304,305,310",
  // La liste des personnages, et rien d'autre
  characters: "200",
  // Maître des postes : inventaires de personnage + instances (puissance)
  postmaster: "200,201,300",
  // Équipement porté + sockets + mods réellement insérables (310) :
  // source de vérité pour poser un mod sur une instance précise
  equipped: "200,205,300,304,305,310",
  // Marchands : ce que tu possèdes déjà (800 collections), tes devises
  // (103) et ton équipement, pour juger l'intérêt d'un objet en vente
  vendorContext: "102,103,200,201,205,300,304,800",
};

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope") ?? "quests";
  const components = SCOPES[scope];
  if (!components) {
    return NextResponse.json({ error: "scope inconnu" }, { status: 400 });
  }

  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  try {
    const profile = await bungieGet<ProfileResponse>(
      `/Destiny2/${ctx.mem.t}/Profile/${ctx.mem.i}/?components=${components}`,
      ctx.access
    );
    const res = NextResponse.json(profile);
    // Le profil change à chaque action (équipement, mod posé) : jamais de cache,
    // ni navigateur ni proxy, sinon on relit un état périmé juste après écriture.
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
