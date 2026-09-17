/*
 * Pas de directive "use client" : rendu uniquement depuis des composants
 * client. La poser ici en ferait une frontière serveur/client, où la prop
 * fonction renderSlot serait à tort refusée.
 */

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUCKET_SUBCLASS,
  BUNGIE_ROOT,
  STAT_CAP,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";

/**
 * L'écran Personnage du jeu, partagé par l'onglet Perso et la fiche clan.
 *
 * Armes à gauche, le Gardien et ses statistiques au centre, l'armure à
 * droite — la disposition du jeu, gardée même sur téléphone : les cases
 * rétrécissent et le centre se resserre plutôt que de tout empiler.
 *
 * Le contenu de chaque case est confié à la page (`renderSlot`) : l'onglet
 * Perso y branche l'échange d'équipement, la fiche clan la seule inspection.
 * `GearTile` leur donne à toutes deux la même apparence.
 */

export type SlotSide = "left" | "right";

export interface GearTileItem {
  name: string;
  icon?: string;
  isExotic: boolean;
  power: number;
}

/** Une case d'équipement : icône, bordure exotique, puissance en coin. */
export function GearTile({
  item,
  selected = false,
  className = "",
  ...rest
}: {
  item: GearTileItem | undefined;
  selected?: boolean;
} & ComponentPropsWithoutRef<"button">) {
  const size = "w-12 h-12 md:w-14 md:h-14";
  if (!item) {
    return (
      <button
        type="button"
        aria-label="Emplacement vide"
        className={`block ${size} rounded bg-base-300/40 border border-base-300 ${className}`}
        {...rest}
      />
    );
  }
  return (
    <button
      type="button"
      title={`${item.name}${item.power > 0 ? ` — ✦ ${item.power}` : ""}`}
      className={`relative block ${size} rounded overflow-hidden border-2 transition-all ${
        selected
          ? "border-primary scale-105"
          : item.isExotic
            ? "border-[#ceae33] hover:border-primary"
            : "border-base-300 hover:border-primary"
      } ${className}`}
      {...rest}
    >
      {item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${BUNGIE_ROOT}${item.icon}`}
          alt={item.name}
          className="w-full h-full"
        />
      ) : (
        <span className="block w-full h-full bg-base-300/40" />
      )}
      {item.power > 0 && (
        <span className="absolute bottom-0 right-0 bg-black/75 text-[10px] font-mono px-1 text-[#ffd970]">
          {item.power}
        </span>
      )}
    </button>
  );
}

/** Puissance moyenne des armes et armures portées (sous-classe exclue). */
export function gearPower(
  powerOf: (bucketHash: number) => number | undefined
): number {
  const powers = [...WEAPON_SLOT_ORDER, ...ARMOR_SLOT_ORDER]
    .map((b) => powerOf(b) ?? 0)
    .filter((p) => p > 0);
  if (powers.length === 0) return 0;
  return Math.floor(powers.reduce((a, v) => a + v, 0) / powers.length);
}

export default function CharacterSheet({
  heading,
  title,
  light,
  equipmentPower,
  stats,
  statNames,
  emblemBackgroundPath,
  renderSlot,
  children,
}: {
  /** Classe, éventuellement suivie de la race */
  heading: string;
  /** Titre (sceau) porté */
  title?: string;
  light: number;
  /** Moyenne de l'équipement porté, quand elle est connue */
  equipmentPower?: number;
  /** Les 6 stats d'armure, alignées sur ARMOR_STAT_HASHES */
  stats: number[];
  statNames: string[];
  emblemBackgroundPath?: string;
  renderSlot: (bucketHash: number, side: SlotSide) => ReactNode;
  /** Mention sous l'écran (ex. équipement privé) */
  children?: ReactNode;
}) {
  return (
    <div
      className="relative bg-cover bg-center rounded-box"
      style={
        emblemBackgroundPath
          ? {
              backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.72), rgba(20,24,31,.94)), url(${BUNGIE_ROOT}${emblemBackgroundPath})`,
            }
          : { backgroundColor: "rgba(20,24,31,.5)" }
      }
    >
      <div className="flex items-start justify-between md:justify-center gap-2 sm:gap-3 md:gap-12 p-2 sm:p-3 md:p-6">
        <div className="flex flex-col gap-2 md:gap-2.5 shrink-0">
          <div className="mb-0.5 md:mb-1">
            {renderSlot(BUCKET_SUBCLASS, "left")}
          </div>
          {WEAPON_SLOT_ORDER.map((b) => (
            <div key={b}>{renderSlot(b, "left")}</div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1 md:gap-3 min-w-0 flex-1 md:flex-none md:min-w-56 px-1 md:py-2">
          <div className="text-[10px] md:text-xs tracking-[0.2em] md:tracking-[0.3em] uppercase opacity-60 text-center">
            {heading}
          </div>
          <div className="flex items-start gap-1">
            <span className="text-[#ffd970] text-base md:text-2xl leading-none mt-1.5 md:mt-2">
              ✦
            </span>
            <span className="text-4xl md:text-6xl font-light text-[#ffd970] leading-none">
              {light}
            </span>
          </div>
          <div className="hidden md:block text-[10px] tracking-[0.25em] uppercase opacity-50">
            Puissance
          </div>
          {title && (
            <div className="text-xs italic opacity-60 truncate max-w-full">
              {title}
            </div>
          )}
          {equipmentPower !== undefined && equipmentPower > 0 && (
            <div className="text-xs opacity-60">
              Équipement : ✦ {equipmentPower}
            </div>
          )}

          <div className="w-full flex flex-col gap-1 md:gap-1.5 mt-2">
            {ARMOR_STAT_HASHES.map((h, i) => {
              const v = stats[i] ?? 0;
              return (
                <div key={h} className="flex items-center gap-1.5 md:gap-2">
                  <span className="text-[11px] w-14 sm:w-20 opacity-70 truncate">
                    {statNames[i]}
                  </span>
                  <progress
                    className="progress progress-primary h-1.5 flex-1"
                    value={Math.min(v, STAT_CAP)}
                    max={STAT_CAP}
                  />
                  <span className="text-[11px] font-mono w-7 md:w-8 text-right tabular-nums">
                    {v}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 md:gap-2.5 shrink-0">
          {ARMOR_SLOT_ORDER.map((b) => (
            <div key={b}>{renderSlot(b, "right")}</div>
          ))}
        </div>
      </div>

      {children}
    </div>
  );
}
