/*
 * Pas de directive "use client" : ce composant n'est rendu que depuis
 * app/clan/page.tsx, qui la porte déjà. La poser ici en ferait une frontière
 * serveur/client, où une prop fonction serait à tort refusée.
 */

import { useEffect, useMemo, useState } from "react";
import { BUNGIE_ROOT } from "@/lib/destiny-constants";
import {
  PLATFORM_NAMES,
  formatPlaytime,
  summarizePlayer,
  type PlayerData,
} from "@/lib/player-client";
import type { Defs } from "@/lib/types";

/**
 * Aperçu au survol : ce que l'on sait déjà du membre (clan) s'affiche
 * immédiatement, le profil Destiny vient le compléter dès qu'il arrive.
 * Le survol ne doit jamais donner l'impression d'attendre.
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

const CARD_WIDTH = 300;

function clampPosition(anchor: HoverAnchor): { top: number; left: number } {
  if (typeof window === "undefined") return { top: anchor.bottom, left: anchor.left };
  const margin = 8;
  const left = Math.min(
    Math.max(margin, anchor.left),
    window.innerWidth - CARD_WIDTH - margin
  );
  // Sous la ligne par défaut, au-dessus s'il n'y a plus la place en bas.
  const spaceBelow = window.innerHeight - anchor.bottom;
  const top = spaceBelow > 260 ? anchor.bottom + 6 : Math.max(margin, anchor.top - 266);
  return { top, left };
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
          <div className="flex items-center gap-2 text-xs opacity-60">
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

        {summary?.characters && summary.characters.length > 0 && (
          <>
            <div className="flex flex-col gap-1">
              {summary.characters.map((c) => (
                <div
                  key={c.characterId}
                  className="flex items-center gap-2 text-xs"
                >
                  {c.emblemPath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${BUNGIE_ROOT}${c.emblemPath}`}
                      alt=""
                      className="w-5 h-5 rounded"
                    />
                  )}
                  <span className="flex-1 truncate">
                    {c.className}
                    {c.title && (
                      <span className="opacity-50 italic"> · {c.title}</span>
                    )}
                  </span>
                  <span className="font-mono text-primary">✦ {c.light}</span>
                </div>
              ))}
            </div>
            <div className="text-[11px] opacity-50 border-t border-base-content/10 pt-1.5">
              Temps de jeu {formatPlaytime(summary.totalMinutes)}
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
