import { NextResponse } from "next/server";
import { bungieGet } from "@/lib/bungie-server";

/**
 * Renvoie la version du manifest + les chemins des tables JSON (fr).
 * Les gros fichiers de définitions sont ensuite téléchargés
 * directement depuis le CDN Bungie par le navigateur.
 */
export async function GET() {
  try {
    const manifest = await bungieGet<{
      version: string;
      jsonWorldComponentContentPaths: Record<string, Record<string, string>>;
    }>("/Destiny2/Manifest/");

    const paths =
      manifest.jsonWorldComponentContentPaths["fr"] ??
      manifest.jsonWorldComponentContentPaths["en"];

    return NextResponse.json({ version: manifest.version, paths });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur manifest" },
      { status: 502 }
    );
  }
}
