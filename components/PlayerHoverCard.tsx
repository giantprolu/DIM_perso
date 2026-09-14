/*
 * Pas de directive "use client" : ce composant n'est rendu que depuis
 * app/clan/page.tsx, qui la porte déjà. La poser ici en ferait une frontière
 * serveur/client, où une prop fonction serait à tort refusée.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  STAT_CAP,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  PLATFORM_NAMES,
  equippedItems,
  formatPlaytime,
  summarizePlayer,
  type CharacterView,
  type EquippedItem,
  type PlayerData,
} from "@/lib/player-client";
import type { Defs } from "@/lib/types";

/**
 * Aperçu au survol : l'écran Personnage du membre survolé, en miniature.
 *
 * Même lecture que la page /perso — armes à gauche, Gardien et statistiques
 * au centre, armure à droite — pour qu'un coup d'œil suffise à savoir avec
 * quoi joue la personne. Ce que l'on sait déjà du clan s'affiche
 * immédiatement, le profil Destiny vient le compléter dès qu'il arrive : le
 * survol ne doit jamais donner l'impression d'attendre.
 */

export interface HoverAnchor {
  /** Rectangle de la ligne survolée, en coordonnées écran */
  top: number;
  bottom: number;
  left: number;
}

export interface HoverMember {
  name: string;
  code?: number;
  icon?: string;
  isOnline?: boolean;
  membershipType?: number;
  role: string;
  joinDate?: string;
  lastSeen: string;
}

const CARD_WIDTH = 380;
const CARD_HEIGHT = 400;

function clampPosition(anchor: HoverAnchor): { top: number; left: number } {
  if (typeof window === "undefined") {
    return { top: anchor.bottom, left: anchor.left };
  }
  const margin = 8;
  const left = Math.min(
    Math.max(margin, anchor.left),
    window.innerWidth - CARD_WIDTH - margin
  );
  // Sous la ligne par défaut, au-dessus s'il n'y a plus la place en bas.
  const spaceBelow = window.innerHeight - anchor.bottom;
  const top =
    spaceBelow > CARD_HEIGHT
      ? anchor.bottom + 6
      : Math.max(margin, window.innerHeight - CARD_HEIGHT - margin);
  return { top, left };
}

/** Une case d'équipement : icône, bordure exotique, puissance en coin. */
function Slot({ item }: { item: EquippedItem | undefined }) {
  if (!item) {
    return <div className="w-9 h-9 rounded bg-base-100/30 border border-base-content/10" />;
  }
  return (
    <div
      className={`relative w-9 h-9 rounded overflow-hidden border ${
        item.isExotic ? "border-[#ceae33]" : "border-base-content/15"
      }`}
    >
      {item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${BUNGIE_ROOT}${item.icon}`}
          alt={item.name}
          className="w-full h-full"
        />
      ) : (
        <span className="block w-full h-full bg-base-100/30" />
      )}
      {item.power > 0 && (
        <span className="absolute bottom-0 right-0 bg-black/75 text-[9px] font-mono px-0.5 text-[#ffd970]">
          {item.power}
        </span>
      )}
    </div>
  );
}

/** L'écran personnage en miniature : armes, Gardien, armure. */
function MiniCharacter({
  character,
  gear,
  statNames,
}: {
  character: CharacterView;
  gear: EquippedItem[] | null;
  statNames: string[];
}) {
  const byBucket = new Map((gear ?? []).map((i) => [i.bucketHash, i]));

  return (
    <div
      className="rounded-box overflow-hidden bg-cover bg-center"
      style={
        character.emblemBackgroundPath
          ? {
              backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.78), rgba(20,24,31,.95)), url(${BUNGIE_ROOT}${character.emblemBackgroundPath})`,
            }
          : { backgroundColor: "rgba(20,24,31,.5)" }
      }
    >
      <div className="flex items-start justify-between gap-2 p-2.5">
        <div className="flex flex-col gap-1.5">
          {WEAPON_SLOT_ORDER.map((b) => (
            <Slot key={b} item={byBucket.get(b)} />
          ))}
        </div>

        <div className="flex flex-col items-center gap-0.5 min-w-0 flex-1 px-1">
          <div className="text-[9px] tracking-[0.2em] uppercase opacity-60 truncate">
            {character.className}
          </div>
          <div className="flex items-start gap-0.5">
            <span className="text-[#ffd970] text-sm leading-none mt-1">✦</span>
            <span className="text-3xl font-light text-[#ffd970] leading-none">
              {character.light}
            </span>
          </div>
          {character.title && (
            <div className="text-[10px] italic opacity-60 truncate max-w-full">
              {character.title}
            </div>
          )}

          <div className="w-full flex flex-col gap-0.5 mt-1.5">
            {character.stats.map((v, i) => (
              <div key={ARMOR_STAT_HASHES[i]} className="flex items-center gap-1">
                <span className="text-[9px] w-12 opacity-70 truncate">
                  {statNames[i]}
                </span>
                <progress
                  className="progress progress-primary h-1 flex-1"
                  value={Math.min(v, STAT_CAP)}
                  max={STAT_CAP}
                />
                <span className="text-[9px] font-mono w-6 text-right tabular-nums">
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          {ARMOR_SLOT_ORDER.map((b) => (
            <Slot key={b} item={byBucket.get(b)} />
          ))}
        </div>
      </div>

      {gear === null && (
        <div className="text-[10px] opacity-50 px-2.5 pb-2">
          Équipement gardé privé.
        </div>
      )}
    </div>
  );
}

export default function PlayerHoverCard({
  member,
  data,
  defs,
  loading,
  error,
  anchor,
}: {
  member: HoverMember;
  data: PlayerData | null;
  defs: Defs | null;
  loading: boolean;
  error: string;
  anchor: HoverAnchor;
}) {
  const [pos, setPos] = useState(() => clampPosition(anchor));
  useEffect(() => setPos(clampPosition(anchor)), [anchor]);

  const summary = useMemo(
    () => (defs && data ? summarizePlayer(defs, data) : null),
    [defs, data]
  );

  // Le personnage joué en dernier : celui que l'on veut voir en survolant.
  const characters = summary?.characters ?? [];
  const character = characters[0];

  const gear = useMemo(
    () =>
      defs && data && character
        ? equippedItems(defs, data, character.characterId)
        : null,
    [defs, data, character]
  );

  const statNames = ARMOR_STAT_HASHES.map(
    (h) => defs?.stats?.[h]?.displayProperties?.name ?? ""
  );

  return (
    <div
      className="fixed z-50 pointer-events-none card bg-base-300 shadow-xl ring-1 ring-base-content/10"
      style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
      role="tooltip"
    >
      <div className="card-body p-3 gap-2">
        <div className="flex items-center gap-2">
          {member.icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${BUNGIE_ROOT}${member.icon}`}
              alt=""
              className="w-8 h-8 rounded"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm truncate">
              {member.name}
              {member.code !== undefined && (
                <span className="opacity-40 font-mono text-xs">
                  #{String(member.code).padStart(4, "0")}
                </span>
              )}
            </div>
            <div className="text-xs opacity-60">
              {member.role}
              {member.membershipType !== undefined &&
                PLATFORM_NAMES[member.membershipType] &&
                ` · ${PLATFORM_NAMES[member.membershipType]}`}
            </div>
          </div>
          <span
            className={`badge badge-sm ${
              member.isOnline ? "badge-success" : "badge-ghost"
            }`}
          >
            {member.isOnline ? "en ligne" : member.lastSeen}
          </span>
        </div>

        {summary?.currentActivity && (
          <div className="rounded-box bg-base-200 px-2 py-1.5">
            <div className="text-xs font-medium truncate">
              🎯 {summary.currentActivity.name}
            </div>
            <div className="text-[11px] opacity-60">
              {summary.currentActivity.mode}
              {summary.currentActivity.sinceMinutes !== undefined &&
                ` · depuis ${summary.currentActivity.sinceMinutes} min`}
            </div>
          </div>
        )}

        {loading && !summary && (
          <div className="flex items-center gap-2 text-xs opacity-60 py-6 justify-center">
            <span className="loading loading-spinner loading-xs" />
            Lecture du profil Destiny…
          </div>
        )}

        {error && <div className="text-xs text-warning">{error}</div>}

        {summary?.privateProfile && (
          <div className="text-xs opacity-60">
            Profil Destiny privé — rien à afficher.
          </div>
        )}

        {character && (
          <>
            <MiniCharacter
              character={character}
              gear={gear}
              statNames={statNames}
            />

            {/* Les autres Gardiens du compte, en une ligne. */}
            {characters.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap text-[11px] opacity-70">
                {characters.slice(1).map((c) => (
                  <span key={c.characterId} className="flex items-center gap-1">
                    {c.emblemPath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${BUNGIE_ROOT}${c.emblemPath}`}
                        alt=""
                        className="w-4 h-4 rounded"
                      />
                    )}
                    {c.className}
                    <span className="font-mono text-primary">✦ {c.light}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="text-[11px] opacity-50 border-t border-base-content/10 pt-1.5">
              Temps de jeu {formatPlaytime(summary?.totalMinutes ?? 0)}
              {member.joinDate &&
                ` · membre depuis ${new Date(member.joinDate).toLocaleDateString("fr-FR")}`}
            </div>
          </>
        )}

        <div className="text-[11px] opacity-40">
          Clique pour la fiche complète
        </div>
      </div>
    </div>
  );
}
