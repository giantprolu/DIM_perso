/*
 * Pas de directive "use client" : ce composant n'est rendu que depuis
 * app/clan/page.tsx, qui la porte déjà. La poser ici en ferait une frontière
 * serveur/client, où une prop fonction (onRelease) serait à tort refusée.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ARMOR_BUCKETS,
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  STAT_CAP,
  WEAPON_BUCKETS,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  PLATFORM_NAMES,
  cachedPlayer,
  careerStats,
  equippedItems,
  fetchPlayer,
  formatPlaytime,
  summarizePlayer,
  type CharacterView,
  type EquippedItem,
  type PlayerData,
} from "@/lib/player-client";
import { instanceFromProfile } from "@/lib/item-info";
import { useInspectItem } from "@/components/ItemInspector";
import type { Defs } from "@/lib/types";

/**
 * Fiche d'un Gardien, en grand.
 *
 * C'est l'écran Personnage du jeu : armes à gauche, le Gardien et ses
 * statistiques au centre, l'armure à droite — la disposition qu'on connaît
 * déjà, pour qu'un coup d'œil suffise. Chaque pièce est inspectable, si bien
 * que la fiche d'objet complète reste à un survol.
 *
 * Le panneau se charge lui-même, avec le cache de `player-client` : survoler
 * dix lignes d'un tableau ne déclenche pas dix lectures du même profil.
 * `full` distingue l'aperçu (survol) de la consultation (clic) : le profil
 * léger arrive vite, le complet ajoute les stats et mods de chaque objet.
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
    WEAPON_BUCKETS[bucketHash] ?? ARMOR_BUCKETS[bucketHash] ?? "Emplacement"
  );
}

/** Une case d'équipement : icône, bordure exotique, puissance en coin. */
function Slot({
  item,
  profile,
  inspect,
}: {
  item: EquippedItem | undefined;
  profile: PlayerData | null;
  inspect: ReturnType<typeof useInspectItem>;
}) {
  if (!item) {
    return (
      <div className="w-12 h-12 rounded bg-base-100/30 border border-base-content/10" />
    );
  }
  return (
    <div
      {...inspect({
        itemHash: item.itemHash,
        instanceId: item.instanceId,
        instance: instanceFromProfile(profile?.profile, item.instanceId),
      })}
      title={item.name}
      className={`relative w-12 h-12 rounded overflow-hidden border cursor-pointer ${
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
        <span className="absolute bottom-0 right-0 bg-black/75 text-[10px] font-mono px-0.5 text-[#ffd970]">
          {item.power}
        </span>
      )}
    </div>
  );
}

/** L'écran personnage : armes, Gardien, armure. */
function CharacterScreen({
  character,
  gear,
  statNames,
  profile,
  inspect,
}: {
  character: CharacterView;
  gear: EquippedItem[] | null;
  statNames: string[];
  profile: PlayerData | null;
  inspect: ReturnType<typeof useInspectItem>;
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
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex flex-col gap-2">
          {WEAPON_SLOT_ORDER.map((b) => (
            <Slot
              key={b}
              item={byBucket.get(b)}
              profile={profile}
              inspect={inspect}
            />
          ))}
        </div>

        <div className="flex flex-col items-center gap-1 min-w-0 flex-1 px-1">
          <div className="text-[10px] tracking-[0.2em] uppercase opacity-60 truncate">
            {character.className}
            {character.raceName && ` · ${character.raceName}`}
          </div>
          <div className="flex items-start gap-1">
            <span className="text-[#ffd970] text-base leading-none mt-1.5">
              ✦
            </span>
            <span className="text-5xl font-light text-[#ffd970] leading-none">
              {character.light}
            </span>
          </div>
          {character.title && (
            <div className="text-xs italic opacity-60 truncate max-w-full">
              {character.title}
            </div>
          )}

          <div className="w-full flex flex-col gap-1 mt-2">
            {character.stats.map((v, i) => (
              <div key={ARMOR_STAT_HASHES[i]} className="flex items-center gap-2">
                <span className="text-[11px] w-20 opacity-70 truncate">
                  {statNames[i]}
                </span>
                <progress
                  className="progress progress-primary h-1.5 flex-1"
                  value={Math.min(v, STAT_CAP)}
                  max={STAT_CAP}
                />
                <span className="text-[11px] font-mono w-7 text-right tabular-nums">
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {ARMOR_SLOT_ORDER.map((b) => (
            <Slot
              key={b}
              item={byBucket.get(b)}
              profile={profile}
              inspect={inspect}
            />
          ))}
        </div>
      </div>

      {gear === null && (
        <div className="text-[11px] opacity-50 px-3 pb-2">
          Équipement gardé privé.
        </div>
      )}
    </div>
  );
}

export default function PlayerPanel({
  target,
  defs,
  defsStatus,
  full,
  pinned = false,
  onRelease,
}: {
  target: PlayerTarget;
  defs: Defs | null;
  defsStatus: string;
  /** true après un clic : on lit alors le profil complet */
  full: boolean;
  pinned?: boolean;
  onRelease?: () => void;
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

    fetchPlayer(target.membershipType, target.membershipId, !full)
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
  }, [target.membershipType, target.membershipId, full]);

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
      <div className="flex items-center gap-3">
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
          {pinned && onRelease && (
            <button className="btn btn-ghost btn-xs" onClick={onRelease}>
              détacher
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

      {characters.length > 1 && (
        <div role="tablist" className="tabs tabs-boxed tabs-sm">
          {characters.map((c) => (
            <a
              key={c.characterId}
              role="tab"
              className={`tab${
                c.characterId === character?.characterId ? " tab-active" : ""
              }`}
              onClick={() => setCharId(c.characterId)}
            >
              {c.className} · ✦ {c.light}
            </a>
          ))}
        </div>
      )}

      {character && (
        <>
          <CharacterScreen
            character={character}
            gear={gear}
            statNames={statNames}
            profile={data}
            inspect={inspect}
          />

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

      {!pinned && (
        <p className="text-[11px] opacity-40">
          Clique un Gardien pour garder sa fiche affichée.
        </p>
      )}
    </div>
  );
}
