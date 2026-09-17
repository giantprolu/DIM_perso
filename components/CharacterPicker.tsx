/*
 * Pas de directive "use client" : rendu uniquement depuis des composants
 * client. La poser ici en ferait une frontière serveur/client, où la prop
 * fonction onSelect serait à tort refusée.
 */

import type { ReactNode } from "react";
import { BUNGIE_ROOT, CLASS_NAMES } from "@/lib/destiny-constants";

/**
 * Rangée de personnages, emblème en fond.
 *
 * Le même sélecteur sur toutes les pages, qu'il s'agisse de tes Gardiens ou
 * de ceux d'un membre du clan : seuls les champs communs aux deux sources
 * sont demandés.
 */

export interface PickableCharacter {
  characterId: string;
  classType: number;
  light: number;
  emblemBackgroundPath?: string;
}

export default function CharacterPicker<C extends PickableCharacter>({
  characters,
  selected,
  onSelect,
  badge,
}: {
  characters: C[];
  selected: string | undefined;
  onSelect: (characterId: string) => void;
  /** Pastille à côté du nom de classe (ex. objets en attente au courrier) */
  badge?: (character: C) => ReactNode;
}) {
  return (
    <div className="char-row">
      {characters.map((c) => (
        <button
          key={c.characterId}
          className={`char-btn${selected === c.characterId ? " active" : ""}`}
          style={
            c.emblemBackgroundPath
              ? {
                  backgroundImage: `url(${BUNGIE_ROOT}${c.emblemBackgroundPath})`,
                }
              : undefined
          }
          onClick={() => onSelect(c.characterId)}
        >
          <div className="char-class">
            {CLASS_NAMES[c.classType] ?? "Gardien"}
            {badge?.(c)}
          </div>
          <div className="char-light">✦ {c.light}</div>
        </button>
      ))}
    </div>
  );
}
