import { NextResponse } from "next/server";
import { bungieGet, errorMessage, errorStatus } from "@/lib/bungie-server";

/**
 * Renvoie la version du manifest + les chemins des tables JSON (fr).
 * Les gros fichiers de définitions sont ensuite téléchargés
 * directement depuis le CDN Bungie par le navigateur.
 */

interface ManifestMeta {
  version: string;
  paths: Record<string, string>;
}

/*
 * Le manifest ne bouge qu'à chaque mise à jour du jeu (quelques fois par mois),
 * alors que CHAQUE page du site interroge cette route au chargement. On garde
 * donc la réponse en mémoire : autant d'appels Bungie économisés, et un
 * démarrage de page plus rapide.
 */
let cached: { at: number; data: ManifestMeta } | null = null;
const TTL_MS = 10 * 60_000;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const manifest = await bungieGet<{
      version: string;
      jsonWorldComponentContentPaths: Record<string, Record<string, string>>;
    }>("/Destiny2/Manifest/");

    const paths =
      manifest.jsonWorldComponentContentPaths["fr"] ??
      manifest.jsonWorldComponentContentPaths["en"];

    const data: ManifestMeta = { version: manifest.version, paths };
    cached = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (e) {
    // Une version un peu datée vaut mieux qu'un site inutilisable pendant la
    // maintenance Bungie : les définitions, elles, sont déjà en IndexedDB.
    if (cached) return NextResponse.json(cached.data);
    return NextResponse.json(
      { error: errorMessage(e) },
      { status: errorStatus(e) }
    );
  }
}
