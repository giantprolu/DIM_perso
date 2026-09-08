import type { ProfileResponse } from "./types";

/**
 * Substitution des variables de texte (composant 1200).
 *
 * Bungie livre certains libellés avec des trous : « Éliminez {var:1234567}
 * ennemis ». La valeur dépend du compte (et parfois du personnage) et arrive
 * dans un composant à part. Sans elle, la page Quêtes affichait le gabarit
 * brut — c'est-à-dire une consigne illisible.
 */

export interface StringVariables {
  profile: Record<string, number>;
  byCharacter: Record<string, Record<string, number>>;
}

export function readStringVariables(profile: ProfileResponse): StringVariables {
  const byCharacter: Record<string, Record<string, number>> = {};
  for (const [charId, entry] of Object.entries(
    profile.characterStringVariables?.data ?? {}
  )) {
    byCharacter[charId] = entry.integerValuesByHash ?? {};
  }
  return {
    profile: profile.profileStringVariables?.data?.integerValuesByHash ?? {},
    byCharacter,
  };
}

const VARIABLE = /\{var:(\d+)\}/g;

/**
 * Remplace les `{var:…}` d'un libellé.
 *
 * Le personnage prime sur le compte : une même variable peut valoir autre
 * chose d'un Gardien à l'autre. Une variable inconnue est effacée plutôt que
 * laissée en gabarit — mieux vaut « Éliminez ennemis » que « {var:123} ».
 */
export function fillVariables(
  text: string | undefined,
  vars: StringVariables | null,
  characterId?: string
): string {
  if (!text) return "";
  if (!vars || !text.includes("{var:")) return text;

  const scoped = characterId ? vars.byCharacter[characterId] : undefined;
  return text.replace(VARIABLE, (_match, hash: string) => {
    const value = scoped?.[hash] ?? vars.profile[hash];
    return value === undefined ? "" : String(value);
  });
}
