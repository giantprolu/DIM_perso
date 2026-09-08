import { NextRequest, NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";
import { getAuthContext, withRefreshedCookies } from "@/lib/auth-server";
import type { ProfileResponse, PublicMilestone } from "@/lib/types";

/**
 * Tout ce qui rythme la semaine, en un seul aller-retour.
 *
 *  - 202 CharacterProgressions : jalons du personnage (activités hebdo et
 *    leurs récompenses), réputations, artefact.
 *  - 104 ProfileProgression : l'artefact vu au niveau du compte.
 *  - 1200 StringVariables : sans elles, les libellés à variables
 *    (« Éliminez {var:…} ennemis ») restent illisibles.
 *  - GetPublicMilestones : la rotation publique (activité de la semaine,
 *    modificateurs), y compris ce que le personnage n'a pas encore vu.
 */
const COMPONENTS = "100,104,200,202,1200";

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "non connecté" }, { status: 401 });

  try {
    const [profile, publicMilestones] = await Promise.all([
      bungieGet<ProfileResponse>(
        `/Destiny2/${ctx.mem.t}/Profile/${ctx.mem.i}/?components=${COMPONENTS}`,
        ctx.access
      ),
      // La rotation publique est un bonus : son absence ne doit pas priver
      // l'utilisateur de ses propres jalons.
      bungieGet<Record<string, PublicMilestone>>("/Destiny2/Milestones/").catch(
        () => null
      ),
    ]);

    const res = NextResponse.json({ profile, publicMilestones });
    res.headers.set("Cache-Control", "no-store");
    return withRefreshedCookies(res, ctx);
  } catch (e) {
    return withRefreshedCookies(
      NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) }),
      ctx
    );
  }
}
