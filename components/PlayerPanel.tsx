/*
 * Pas de directive "use client" : ce composant n'est rendu que depuis
 * app/clan/page.tsx, qui la porte déjà. La poser ici en ferait une frontière
 * serveur/client, où une prop fonction (onClose) serait à tort refusée.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ARMOR_BUCKETS,
  ARMOR_STAT_HASHES,
  BUCKET_SUBCLASS,
  BUNGIE_ROOT,
  WEAPON_BUCKETS,
} from "@/lib/destiny-constants";
import {
  PLATFORM_NAMES,
  cachedPlayer,
  careerStats,
  equippedItems,
  fetchPlayer,
  formatPlaytime,
  summarizePlayer,
  type PlayerData,
} from "@/lib/player-client";
import { instanceFromProfile } from "@/lib/item-info";
import { useInspectItem } from "@/components/ItemInspector";
import CharacterPicker from "@/components/CharacterPicker";
import CharacterSheet, { GearTile, gearPower } from "@/components/CharacterSheet";
import type { Defs } from "@/lib/types";

/**
 * Fiche d'un Gardien, en grand.
 *
 * C'est le même écran Personnage que l'onglet Perso (`CharacterSheet`) : la
 * disposition qu'on connaît déjà, pour qu'un coup d'œil suffise. Chaque pièce
 * est inspectable, si bien que la fiche d'objet complète reste à un survol.
 *
 * Le panneau se charge lui-même, avec le cache de `player-client` : revenir
 * sur un Gardien déjà consulté ne relit rien. Le profil demandé est le
 * complet, celui qui porte les stats et les mods de chaque objet.
 */

export interface PlayerTarget {
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
    WEAPON_BUCKETS[bucketHash] ??
    ARMOR_BUCKETS[bucketHash] ??
    (bucketHash === BUCKET_SUBCLASS ? "Sous-classe" : "Emplacement")
  );
}

export default function PlayerPanel({
  target,
  defs,
  defsStatus,
  onClose,
}: {
  target: PlayerTarget;
  defs: Defs | null;
  defsStatus: string;
  onClose?: () => void;
}) {
  const [data, setData] = useState<PlayerData | null>(() =>
    cachedPlayer(target.membershipType, target.membershipId)
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [charId, setCharId] = useState("");
  const inspect = useInspectItem();

  /*
   * Changer de Gardien remet tout à plat, cache compris : sans cela, la fiche
   * du précédent resterait affichée le temps de la lecture, et le personnage
   * sélectionné n'aurait aucun sens pour le nouveau.
   */
  useEffect(() => {
    let cancelled = false;
    const cached = cachedPlayer(target.membershipType, target.membershipId);
    setData(cached);
    setError("");
    setCharId("");
    setLoading(!cached);

    fetchPlayer(target.membershipType, target.membershipId, false)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled && !cached) {
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

  const summary = useMemo(
    () => (defs && data ? summarizePlayer(defs, data) : null),
    [defs, data]
  );

  const characters = summary?.characters ?? [];
  // À défaut de choix explicite, le Gardien joué en dernier.
  const character =
    characters.find((c) => c.characterId === charId) ?? characters[0];

  const gear = useMemo(
    () =>
      defs && data && character
        ? equippedItems(defs, data, character.characterId)
        : null,
    [defs, data, character]
  );
  const career = useMemo(() => (data ? careerStats(data) : []), [data]);

  const statNames = ARMOR_STAT_HASHES.map(
    (h) => defs?.stats?.[h]?.displayProperties?.name ?? `Stat ${h}`
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 sm:gap-3">
        {target.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${BUNGIE_ROOT}${target.icon}`}
            alt=""
            className="w-11 h-11 rounded"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold truncate">
            {target.name}
            {target.code !== undefined && (
              <span className="opacity-40 font-mono text-sm">
                #{String(target.code).padStart(4, "0")}
              </span>
            )}
          </h3>
          <div className="text-xs opacity-70 truncate">
            {target.role}
            {PLATFORM_NAMES[target.membershipType] &&
              ` · ${PLATFORM_NAMES[target.membershipType]}`}
            {target.joinDate &&
              ` · membre depuis ${new Date(target.joinDate).toLocaleDateString("fr-FR")}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`badge ${target.isOnline ? "badge-success" : "badge-ghost"}`}
          >
            {target.isOnline ? "en ligne" : target.lastSeen}
          </span>
          {onClose && (
            <button className="btn btn-ghost btn-xs" onClick={onClose}>
              fermer
            </button>
          )}
        </div>
      </div>

      {(loading || !defs) && !summary && (
        <div className="flex items-center gap-3 opacity-70 py-6">
          <span className="loading loading-spinner" />
          <span className="text-sm">
            {!defs ? defsStatus : "Lecture du profil Destiny…"}
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="alert alert-warning text-sm">
          <span>{error}</span>
        </div>
      )}

      {summary?.privateProfile && (
        <div role="alert" className="alert text-sm">
          <span>
            Ce joueur garde son profil Destiny privé. Seules les informations de
            clan sont visibles.
          </span>
        </div>
      )}

      {summary?.currentActivity && (
        <div className="rounded-box bg-base-300 px-3 py-2 flex items-center gap-3">
          <span className="text-xl">🎯</span>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">
              {summary.currentActivity.name}
            </div>
            <div className="text-xs opacity-60">
              {summary.currentActivity.mode}
              {summary.currentActivity.sinceMinutes !== undefined &&
                ` · depuis ${summary.currentActivity.sinceMinutes} min`}
            </div>
          </div>
        </div>
      )}

      {characters.length > 0 && (
        <CharacterPicker
          characters={characters}
          selected={character?.characterId}
          onSelect={setCharId}
        />
      )}

      {character && (
        <>
          <CharacterSheet
            heading={
              character.raceName
                ? `${character.className} · ${character.raceName}`
                : character.className
            }
            title={character.title}
            light={character.light}
            equipmentPower={gearPower(
              (b) => gear?.find((i) => i.bucketHash === b)?.power
            )}
            stats={character.stats}
            statNames={statNames}
            emblemBackgroundPath={character.emblemBackgroundPath}
            renderSlot={(bucket) => {
              const item = gear?.find((i) => i.bucketHash === bucket);
              return (
                <GearTile
                  item={item}
                  disabled={!item}
                  {...inspect(
                    item && {
                      itemHash: item.itemHash,
                      instanceId: item.instanceId,
                      instance: instanceFromProfile(
                        data?.profile,
                        item.instanceId
                      ),
                    }
                  )}
                />
              );
            }}
          >
            {gear === null && (
              <div className="text-[11px] opacity-50 px-3 pb-2">
                Équipement gardé privé.
              </div>
            )}
          </CharacterSheet>

          <div className="flex flex-wrap items-center gap-3 text-xs opacity-70">
            {character.level !== undefined && (
              <span>niveau {character.level}</span>
            )}
            <span>temps de jeu {formatPlaytime(character.minutesPlayed)}</span>
            {summary && (
              <span>
                compte : {formatPlaytime(summary.totalMinutes)} au total
              </span>
            )}
          </div>

          {gear !== null && gear.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider opacity-50 mb-1.5">
                Équipement porté
              </div>
              <div className="flex flex-col gap-1">
                {gear.map((item) => (
                  <div
                    key={item.instanceId}
                    {...inspect({
                      itemHash: item.itemHash,
                      instanceId: item.instanceId,
                      instance: instanceFromProfile(
                        data?.profile,
                        item.instanceId
                      ),
                    })}
                    className="flex items-center gap-2.5 bg-base-300/60 rounded-box px-2 py-1.5 cursor-pointer hover:bg-base-300 transition-colors"
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
            </div>
          )}
        </>
      )}

      {career.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider opacity-50 mb-1.5">
            Carrière (JcE)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {career.map((s) => (
              <span key={s.label} className="badge badge-outline badge-sm">
                {s.label} : {s.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
