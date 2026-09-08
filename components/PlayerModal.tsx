/*
 * Pas de directive "use client" : ce composant n'est rendu que depuis
 * app/clan/page.tsx, qui la porte déjà. La poser ici en ferait une frontière
 * serveur/client, où une prop fonction (onClose) serait à tort refusée.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ARMOR_BUCKETS,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  WEAPON_BUCKETS,
} from "@/lib/destiny-constants";
import {
  PLATFORM_NAMES,
  careerStats,
  equippedItems,
  fetchPlayer,
  formatPlaytime,
  summarizePlayer,
  type PlayerData,
} from "@/lib/player-client";
import type { Defs } from "@/lib/types";

/**
 * Fiche complète d'un membre du clan : ses personnages tels qu'ils sont en
 * jeu — puissance, stats, activité en cours et équipement porté.
 *
 * Un profil peut être restreint côté Bungie : chaque section sait le dire
 * plutôt que d'afficher un vide inexpliqué.
 */

export interface ModalTarget {
  membershipType: number;
  membershipId: string;
  name: string;
  code?: number;
  icon?: string;
  isOnline?: boolean;
  role: string;
  joinDate?: string;
  lastSeen: string;
}

function slotName(bucketHash: number): string {
  return (
    WEAPON_BUCKETS[bucketHash] ?? ARMOR_BUCKETS[bucketHash] ?? "Emplacement"
  );
}

export default function PlayerModal({
  target,
  defs,
  defsStatus,
  onClose,
}: {
  target: ModalTarget;
  defs: Defs | null;
  defsStatus: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<PlayerData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [charId, setCharId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchPlayer(target.membershipType, target.membershipId, false)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Profil illisible");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.membershipType, target.membershipId]);

  // Fermeture au clavier : une modale doit toujours se quitter sans la souris.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = useMemo(
    () => (defs && data ? summarizePlayer(defs, data) : null),
    [defs, data]
  );

  useEffect(() => {
    if (summary?.characters?.length && !charId) {
      setCharId(summary.characters[0].characterId);
    }
  }, [summary, charId]);

  const character = summary?.characters?.find((c) => c.characterId === charId);
  const gear = useMemo(
    () => (defs && data && charId ? equippedItems(defs, data, charId) : null),
    [defs, data, charId]
  );
  const career = useMemo(() => (data ? careerStats(data) : []), [data]);

  const statNames = ARMOR_STAT_HASHES.map(
    (h) => defs?.stats?.[h]?.displayProperties?.name ?? `Stat ${h}`
  );

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true">
      <div className="modal-box max-w-4xl p-0 overflow-hidden">
        <div
          className="relative px-5 py-4 bg-cover bg-center"
          style={
            character?.emblemBackgroundPath
              ? {
                  backgroundImage: `linear-gradient(to right, rgba(20,24,31,.92), rgba(20,24,31,.6)), url(${BUNGIE_ROOT}${character.emblemBackgroundPath})`,
                }
              : undefined
          }
        >
          <button
            className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
          <div className="flex items-center gap-3">
            {target.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${BUNGIE_ROOT}${target.icon}`}
                alt=""
                className="w-11 h-11 rounded"
              />
            )}
            <div className="min-w-0">
              <h3 className="text-lg font-semibold truncate">
                {target.name}
                {target.code !== undefined && (
                  <span className="opacity-40 font-mono text-sm">
                    #{String(target.code).padStart(4, "0")}
                  </span>
                )}
              </h3>
              <div className="text-xs opacity-70">
                {target.role}
                {PLATFORM_NAMES[target.membershipType] &&
                  ` · ${PLATFORM_NAMES[target.membershipType]}`}
                {target.joinDate &&
                  ` · membre depuis ${new Date(target.joinDate).toLocaleDateString("fr-FR")}`}
              </div>
            </div>
            <span
              className={`badge ml-auto ${
                target.isOnline ? "badge-success" : "badge-ghost"
              }`}
            >
              {target.isOnline ? "en ligne" : target.lastSeen}
            </span>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {(loading || !defs) && (
            <div className="flex items-center gap-3 opacity-70 py-6">
              <span className="loading loading-spinner" />
              <span className="text-sm">
                {!defs ? defsStatus : "Lecture du profil Destiny…"}
              </span>
            </div>
          )}

          {error && (
            <div role="alert" className="alert alert-warning">
              <span>{error}</span>
            </div>
          )}

          {summary?.privateProfile && (
            <div role="alert" className="alert">
              <span>
                Ce joueur garde son profil Destiny privé. Seules les
                informations de clan sont visibles.
              </span>
            </div>
          )}

          {summary?.currentActivity && (
            <div className="card bg-base-200">
              <div className="card-body p-3 flex-row items-center gap-3">
                <span className="text-2xl">🎯</span>
                <div className="min-w-0">
                  <div className="font-medium">
                    {summary.currentActivity.name}
                  </div>
                  <div className="text-xs opacity-60">
                    {summary.currentActivity.mode}
                    {summary.currentActivity.sinceMinutes !== undefined &&
                      ` · depuis ${summary.currentActivity.sinceMinutes} min`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {summary?.characters && summary.characters.length > 0 && (
            <>
              <div role="tablist" className="tabs tabs-boxed">
                {summary.characters.map((c) => (
                  <a
                    key={c.characterId}
                    role="tab"
                    className={`tab${c.characterId === charId ? " tab-active" : ""}`}
                    onClick={() => setCharId(c.characterId)}
                  >
                    {c.className} · ✦ {c.light}
                  </a>
                ))}
              </div>

              {character && (
                <>
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="stats stats-horizontal bg-base-200">
                      <div className="stat py-2 px-4">
                        <div className="stat-title text-xs">Puissance</div>
                        <div className="stat-value text-2xl text-primary">
                          {character.light}
                        </div>
                      </div>
                      {character.level !== undefined && (
                        <div className="stat py-2 px-4">
                          <div className="stat-title text-xs">Niveau</div>
                          <div className="stat-value text-2xl">
                            {character.level}
                          </div>
                        </div>
                      )}
                      <div className="stat py-2 px-4">
                        <div className="stat-title text-xs">Temps de jeu</div>
                        <div className="stat-value text-xl">
                          {formatPlaytime(character.minutesPlayed)}
                        </div>
                      </div>
                    </div>
                    {character.title && (
                      <span className="badge badge-outline badge-primary">
                        {character.title}
                      </span>
                    )}
                    {character.raceName && (
                      <span className="text-xs opacity-60">
                        {character.raceName}
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2">Statistiques</div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {character.stats.map((v, i) => (
                        <div key={ARMOR_STAT_HASHES[i]} className="flex items-center gap-2">
                          <span className="text-xs opacity-70 w-24 truncate">
                            {statNames[i]}
                          </span>
                          <progress
                            className="progress progress-primary flex-1"
                            value={Math.min(v, 200)}
                            max={200}
                          />
                          <span className="text-xs font-mono w-8 text-right">
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2">
                      Équipement porté
                    </div>
                    {gear === null ? (
                      <div className="text-xs opacity-60">
                        Ce joueur garde son équipement privé.
                      </div>
                    ) : gear.length === 0 ? (
                      <div className="text-xs opacity-60">
                        Rien à afficher pour ce personnage.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {gear.map((item) => (
                          <div
                            key={item.instanceId}
                            className="flex items-center gap-2.5 bg-base-200 rounded-box px-2 py-1.5"
                          >
                            {item.icon && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`${BUNGIE_ROOT}${item.icon}`}
                                alt=""
                                className={`item-icon${item.isExotic ? " exotic" : ""}`}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {item.name}
                              </div>
                              <div className="text-[11px] opacity-50 truncate">
                                {slotName(item.bucketHash)}
                                {item.typeName && ` · ${item.typeName}`}
                                {item.plugs.length > 0 &&
                                  ` · ${item.plugs.map((p) => p.name).join(", ")}`}
                              </div>
                            </div>
                            {item.damageIcon && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`${BUNGIE_ROOT}${item.damageIcon}`}
                                alt={item.damageName ?? ""}
                                title={item.damageName}
                                className="w-4 h-4 opacity-80"
                              />
                            )}
                            {item.power > 0 && (
                              <span className="font-mono text-sm text-primary">
                                {item.power}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {career.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">Carrière (JcE)</div>
              <div className="flex flex-wrap gap-2">
                {career.map((s) => (
                  <span key={s.label} className="badge badge-outline">
                    {s.label} : {s.value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        className="modal-backdrop bg-black/50"
        onClick={onClose}
        role="presentation"
      />
    </div>
  );
}
