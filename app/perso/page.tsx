"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_STAT_HASHES,
  BUCKET_SUBCLASS,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_STATE_LOCKED,
  ITEM_TYPE_ARMOR,
  ITEM_TYPE_WEAPON,
  TIER_EXOTIC,
} from "@/lib/destiny-constants";
import {
  ApiError,
  applyEquipLocally,
  applyItemStateLocally,
  applySocketsLocally,
  buildLocationMap,
  equippedInstance,
  equipItems,
  fetchProfileFresh,
  insertPlug,
  moveToCharacter,
  setLocked,
  sleep,
  type ItemLocation,
} from "@/lib/d2-actions";
import { buildItemDetail, type ItemDetail } from "@/lib/item-detail";
import { instanceFromProfile } from "@/lib/item-info";
import { useInspectItem } from "@/components/ItemInspector";
import CharacterPicker from "@/components/CharacterPicker";
import CharacterSheet, { GearTile, gearPower } from "@/components/CharacterSheet";
import { useCanHover } from "@/lib/use-media";
import type {
  Character,
  Defs,
  ProfileItem,
  ProfileResponse,
  SocketState,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

interface SlotItem {
  bucketHash: number;
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  isExotic: boolean;
  power: number;
  isWeapon: boolean;
}

interface Candidate {
  instanceId: string;
  itemHash: number;
  bucketHash: number;
  name: string;
  icon?: string;
  power: number;
  isExotic: boolean;
  where: string;
}

/**
 * Emplacements d'une instance avec un plug remplacé — utilisé quand Bungie
 * confirme la pose sans renvoyer l'objet.
 */
function patchedSockets(
  profile: ProfileResponse,
  instanceId: string,
  socketIndex: number,
  plugHash: number
): SocketState[] {
  const current =
    profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const next = [...current];
  next[socketIndex] = { ...next[socketIndex], plugHash };
  return next;
}

function isLockedIn(profile: ProfileResponse, instanceId: string): boolean {
  const lists = [
    ...(profile.profileInventory?.data?.items ?? []),
    ...Object.values(profile.characterInventories?.data ?? {}).flatMap(
      (i) => i.items
    ),
    ...Object.values(profile.characterEquipment?.data ?? {}).flatMap(
      (i) => i.items
    ),
  ];
  const item = lists.find((i) => i.itemInstanceId === instanceId);
  return ((item?.state ?? 0) & ITEM_STATE_LOCKED) !== 0;
}

export default function PersoPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [hoverBucket, setHoverBucket] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspect = useInspectItem();
  /*
   * Sans souris, le survol n'existe pas : toucher un emplacement ouvre la
   * liste d'échange dans un panneau en bas d'écran, et affiche le détail.
   */
  const canHover = useCanHover();

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-8), m]);
  }

  const fetchProfile = useCallback(async (): Promise<ProfileResponse | null> => {
    try {
      const data = await fetchProfileFresh("perso");
      setProfile(data);
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setPhase("unauth");
        return null;
      }
      throw e;
    }
  }, []);

  /**
   * Relit le profil sans laisser l'écran revenir en arrière.
   *
   * Bungie met quelques secondes à servir le nouvel état : une relecture
   * immédiate rend souvent l'ancienne arme ou l'ancien mod. `stillTrue` dit si
   * la réponse porte déjà le changement ; sinon on garde ce qu'on affiche —
   * l'action, elle, a bien été confirmée.
   */
  const resync = useCallback(
    async (
      stillTrue: (p: ProfileResponse) => boolean,
      patch: (p: ProfileResponse) => ProfileResponse
    ) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(attempt === 0 ? 900 : 1800);
        try {
          const fresh = await fetchProfileFresh("perso");
          if (stillTrue(fresh)) {
            setProfile(fresh);
            return;
          }
          // Réponse en retard : on la garde, corrigée de ce qu'on sait déjà.
          setProfile(patch(fresh));
        } catch {
          return;
        }
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Récupération de ton personnage…");
        const data = await fetchProfile();
        if (!data || cancelled) return;
        const chars = Object.values(data.characters?.data ?? {});
        chars.sort(
          (a, b) =>
            new Date(b.dateLastPlayed).getTime() -
            new Date(a.dateLastPlayed).getTime()
        );
        if (chars.length > 0) setSelectedChar(chars[0].characterId);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  const currentChar = characters.find((c) => c.characterId === selectedChar);

  const equipped: SlotItem[] = useMemo(() => {
    if (!defs || !profile || !selectedChar) return [];
    const items = profile.characterEquipment?.data?.[selectedChar]?.items ?? [];
    const instances = profile.itemComponents?.instances?.data ?? {};
    const out: SlotItem[] = [];
    for (const item of items) {
      if (!item.itemInstanceId) continue;
      const def = defs.items[item.itemHash];
      if (!def) continue;
      out.push({
        bucketHash: item.bucketHash,
        instanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        name: def.displayProperties?.name ?? "Objet",
        icon: def.displayProperties?.icon,
        isExotic: def.inventory?.tierType === TIER_EXOTIC,
        power: instances[item.itemInstanceId]?.primaryStat?.value ?? 0,
        isWeapon: def.itemType === ITEM_TYPE_WEAPON,
      });
    }
    return out;
  }, [defs, profile, selectedChar]);

  const byBucket = useMemo(() => {
    const m = new Map<number, SlotItem>();
    for (const i of equipped) m.set(i.bucketHash, i);
    return m;
  }, [equipped]);

  const locations = useMemo(
    () =>
      profile ? buildLocationMap(profile) : new Map<string, ItemLocation>(),
    [profile]
  );

  const charClassById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of characters) m.set(c.characterId, c.classType);
    return m;
  }, [characters]);

  /** Alternatives équipables pour un emplacement (coffre + inventaires). */
  const candidatesFor = useCallback(
    (bucket: number): Candidate[] => {
      if (!defs || !profile || !currentChar) return [];
      const equippedId = byBucket.get(bucket)?.instanceId;
      const instances = profile.itemComponents?.instances?.data ?? {};
      const all: ProfileItem[] = [
        ...(profile.profileInventory?.data?.items ?? []),
        ...Object.values(profile.characterInventories?.data ?? {}).flatMap(
          (inv) => inv.items
        ),
      ];
      const out: Candidate[] = [];
      for (const item of all) {
        if (!item.itemInstanceId || item.itemInstanceId === equippedId) continue;
        const def = defs.items[item.itemHash];
        if (!def) continue;
        if (def.inventory?.bucketTypeHash !== bucket) continue;
        if (
          def.itemType === ITEM_TYPE_ARMOR &&
          def.classType !== currentChar.classType
        ) {
          continue;
        }
        const loc = locations.get(item.itemInstanceId);
        if (loc?.equipped) continue; // équipé ailleurs : à déséquiper en jeu
        const where =
          !loc || loc.characterId === null
            ? "Coffre"
            : loc.characterId === selectedChar
              ? "Inventaire"
              : (CLASS_NAMES[charClassById.get(loc.characterId) ?? -1] ??
                "Autre");
        out.push({
          instanceId: item.itemInstanceId,
          itemHash: item.itemHash,
          bucketHash: bucket,
          name: def.displayProperties?.name ?? "Objet",
          icon: def.displayProperties?.icon,
          power: instances[item.itemInstanceId]?.primaryStat?.value ?? 0,
          isExotic: def.inventory?.tierType === TIER_EXOTIC,
          where,
        });
      }
      return out.sort((a, b) => b.power - a.power).slice(0, 24);
    },
    [
      defs,
      profile,
      currentChar,
      byBucket,
      locations,
      selectedChar,
      charClassById,
    ]
  );

  const equipmentPower = useMemo(
    () => gearPower((b) => byBucket.get(b)?.power),
    [byBucket]
  );

  const statNames = useMemo(
    () =>
      ARMOR_STAT_HASHES.map(
        (h) => defs?.stats?.[h]?.displayProperties?.name ?? `Stat ${h}`
      ),
    [defs]
  );

  /** Détail complet de l'objet sélectionné. */
  const detail: ItemDetail | null = useMemo(() => {
    if (!defs || !profile || !selectedItem) return null;
    const all: ProfileItem[] = [
      ...Object.values(profile.characterEquipment?.data ?? {}).flatMap(
        (i) => i.items
      ),
      ...Object.values(profile.characterInventories?.data ?? {}).flatMap(
        (i) => i.items
      ),
      ...(profile.profileInventory?.data?.items ?? []),
    ];
    const item = all.find((i) => i.itemInstanceId === selectedItem);
    return item ? buildItemDetail(defs, profile, item) : null;
  }, [defs, profile, selectedItem]);

  async function equipCandidate(c: Candidate) {
    if (busy || !selectedChar) return;
    setBusy(true);
    setHoverBucket(null);
    try {
      const ok = await moveToCharacter({
        instanceId: c.instanceId,
        itemHash: c.itemHash,
        name: c.name,
        targetCharId: selectedChar,
        location: locations.get(c.instanceId),
        log: pushLog,
      });
      if (!ok) return;
      const res = await equipItems({
        itemIds: [c.instanceId],
        characterId: selectedChar,
      });
      const status = res.results[0]?.equipStatus;
      if (status !== 1) {
        pushLog(
          `⚠️ ${c.name} : non équipé (code ${status} — es-tu en orbite ?)`
        );
        await fetchProfile();
        return;
      }

      pushLog(`✅ ${c.name} équipé.`);
      // L'écran suit tout de suite ; la relecture confirmera derrière.
      const patch = (p: ProfileResponse) =>
        applyEquipLocally(p, {
          characterId: selectedChar,
          instanceId: c.instanceId,
          bucketHash: c.bucketHash,
        });
      setProfile((prev) => (prev ? patch(prev) : prev));
      void resync(
        (p) =>
          equippedInstance(p, selectedChar, c.bucketHash) === c.instanceId,
        patch
      );
    } catch (e) {
      pushLog(`❌ ${c.name} : ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyPlug(socketIndex: number, plugHash: number, name: string) {
    if (!detail || busy) return;
    setBusy(true);
    const itemId = detail.instanceId;
    try {
      const res = await insertPlug({
        itemId,
        characterId: selectedChar,
        socketIndex,
        plugItemHash: plugHash,
      });
      if (res.applied === false) {
        pushLog(`⚠️ ${name} : Bungie a posé autre chose dans l'emplacement.`);
      } else {
        pushLog(`🔧 ${name} posé sur ${detail.name}.`);
      }

      // Bungie renvoie l'objet modifié : c'est la source de vérité immédiate,
      // bien avant que le profil complet ne reflète le changement.
      const sockets: SocketState[] | null = res.sockets;
      const patch = (p: ProfileResponse) =>
        sockets
          ? applySocketsLocally(p, itemId, sockets)
          : applySocketsLocally(p, itemId, patchedSockets(p, itemId, socketIndex, plugHash));
      setProfile((prev) => (prev ? patch(prev) : prev));
      void resync(
        (p) =>
          p.itemComponents?.sockets?.data?.[itemId]?.sockets?.[socketIndex]
            ?.plugHash === plugHash,
        patch
      );
    } catch (e) {
      pushLog(
        `⚠️ ${name} : ${e instanceof Error ? e.message : "refusé (énergie ?)"}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    if (!detail || busy) return;
    setBusy(true);
    try {
      await setLocked({
        state: !detail.isLocked,
        itemId: detail.instanceId,
        characterId: selectedChar,
      });
      const locked = !detail.isLocked;
      pushLog(
        locked
          ? `🔒 ${detail.name} verrouillé.`
          : `🔓 ${detail.name} déverrouillé.`
      );
      const id = detail.instanceId;
      const patch = (p: ProfileResponse) =>
        applyItemStateLocally(p, id, ITEM_STATE_LOCKED, locked);
      setProfile((prev) => (prev ? patch(prev) : prev));
      void resync(
        (p) => isLockedIn(p, id) === locked,
        patch
      );
    } catch (e) {
      pushLog(`⚠️ ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  function openHover(bucket: number) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoverBucket(bucket);
  }
  function closeHoverSoon() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverBucket(null), 220);
  }

  function ItemTile({
    bucket,
    side,
  }: {
    bucket: number;
    side: "left" | "right";
  }) {
    const item = byBucket.get(bucket);
    const open = hoverBucket === bucket;
    const candidates = open ? candidatesFor(bucket) : [];
    const swappable = bucket !== BUCKET_SUBCLASS;

    return (
      <div
        className="relative"
        onMouseEnter={() => canHover && swappable && openHover(bucket)}
        onMouseLeave={() => canHover && closeHoverSoon()}
      >
        <GearTile
          item={item}
          selected={!!item && selectedItem === item.instanceId}
          onClick={() => {
            if (canHover) {
              if (item) {
                setSelectedItem(
                  selectedItem === item.instanceId ? null : item.instanceId
                );
              }
              return;
            }
            if (item) setSelectedItem(item.instanceId);
            if (swappable) setHoverBucket(bucket);
          }}
        />

        {open && swappable && !canHover && (
          <div
            className="fixed inset-0 z-40 bg-black/50"
            role="presentation"
            onClick={() => setHoverBucket(null)}
          />
        )}

        {open && swappable && (
          <div
            className={
              canHover
                ? `absolute top-0 z-30 w-64 max-h-80 overflow-y-auto bg-base-300 border border-primary/40 rounded-box shadow-xl p-2 ${
                    side === "left" ? "left-16" : "right-16"
                  }`
                : "fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto bg-base-300 border-t border-primary/40 rounded-t-box shadow-xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            }
            onMouseEnter={() => canHover && openHover(bucket)}
            onMouseLeave={() => canHover && closeHoverSoon()}
          >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-60 px-1 pb-1">
              <span className="flex-1">
                Changer — {candidates.length} disponibles
              </span>
              {!canHover && (
                <button
                  className="btn btn-ghost btn-xs normal-case"
                  onClick={() => setHoverBucket(null)}
                >
                  Fermer
                </button>
              )}
            </div>
            {candidates.length === 0 ? (
              <div className="text-xs opacity-50 px-1 py-2">
                Aucune alternative dans le coffre ou tes inventaires.
              </div>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.instanceId}
                  disabled={busy}
                  /*
                   * Survol : la fiche de l'alternative, pour choisir sans
                   * l'équiper. Le clic reste l'équipement — c'est le geste
                   * attendu dans cette liste.
                   */
                  {...inspect(
                    {
                      itemHash: c.itemHash,
                      instanceId: c.instanceId,
                      instance: instanceFromProfile(profile, c.instanceId),
                    },
                    { clickable: false }
                  )}
                  className={`flex items-center gap-2 w-full text-left rounded px-1 hover:bg-base-100 disabled:opacity-40 ${
                    canHover ? "py-1" : "py-2"
                  }`}
                  onClick={() => equipCandidate(c)}
                >
                  {c.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${BUNGIE_ROOT}${c.icon}`}
                      alt=""
                      className={`w-8 h-8 rounded border ${
                        c.isExotic ? "border-[#ceae33]" : "border-base-300"
                      }`}
                    />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs truncate">{c.name}</span>
                    <span className="block text-[10px] opacity-50">
                      {c.where}
                    </span>
                  </span>
                  {c.power > 0 && (
                    <span className="text-[11px] font-mono text-[#ffd970]">
                      {c.power}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 opacity-70">
        <span className="loading loading-spinner loading-lg text-primary" />
        <div className="text-sm">{statusMsg}</div>
      </div>
    );
  }
  if (phase === "unauth") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="opacity-70">Connecte-toi pour voir ton personnage.</p>
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div role="alert" className="alert alert-error">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CharacterPicker
        characters={characters}
        selected={selectedChar}
        onSelect={(id) => {
          setSelectedChar(id);
          setSelectedItem(null);
        }}
      />

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* ── Écran personnage ── */}
      <div className="card bg-base-200 shadow overflow-visible">
        <CharacterSheet
          heading={CLASS_NAMES[currentChar?.classType ?? 0] ?? "Gardien"}
          light={currentChar?.light ?? 0}
          equipmentPower={equipmentPower}
          stats={ARMOR_STAT_HASHES.map(
            (h) => currentChar?.stats?.[String(h)] ?? 0
          )}
          statNames={statNames}
          emblemBackgroundPath={currentChar?.emblemBackgroundPath}
          renderSlot={(bucket, side) => <ItemTile bucket={bucket} side={side} />}
        />
      </div>

      <p className="text-xs opacity-50 text-center">
        {canHover ? (
          <>
            Survole un emplacement pour changer d&apos;arme ou de pièce
            d&apos;armure · clique pour voir le détail complet.
          </>
        ) : (
          <>
            Touche un emplacement pour changer d&apos;arme ou de pièce
            d&apos;armure — son détail complet s&apos;affiche plus bas.
          </>
        )}
      </p>

      {/* ── Détail complet ── */}
      {detail && (
        <div className="card bg-base-200 shadow overflow-hidden">
          {detail.screenshot && (
            <div
              className="h-32 bg-cover bg-center"
              style={{
                backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.25), rgba(20,24,31,.95)), url(${BUNGIE_ROOT}${detail.screenshot})`,
              }}
            />
          )}
          <div className="card-body p-4 sm:p-5 gap-4">
            <div className="flex items-start gap-3 flex-wrap">
              {detail.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={`item-icon${detail.isExotic ? " exotic" : ""}`}
                  src={`${BUNGIE_ROOT}${detail.icon}`}
                  alt=""
                />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="card-title text-base gap-2 flex-wrap">
                  {detail.name}
                  {detail.isMasterwork && (
                    <span className="badge badge-sm badge-warning">
                      chef-d&apos;œuvre
                    </span>
                  )}
                  {detail.isCrafted && (
                    <span className="badge badge-sm badge-info">façonnée</span>
                  )}
                  {detail.isLocked && (
                    <span className="badge badge-sm badge-ghost">🔒</span>
                  )}
                </h2>
                <div className="text-xs opacity-60 flex items-center gap-1.5 flex-wrap mt-0.5">
                  <span>
                    {detail.tierName} · {detail.typeName}
                  </span>
                  {detail.power > 0 && (
                    <span className="text-[#ffd970]">✦ {detail.power}</span>
                  )}
                  {detail.damageIcon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="damage-icon"
                      src={`${BUNGIE_ROOT}${detail.damageIcon}`}
                      alt=""
                    />
                  )}
                  {detail.damageName && <span>{detail.damageName}</span>}
                  {detail.energyCapacity > 0 && (
                    <span>
                      · énergie {detail.energyUsed}/{detail.energyCapacity}
                    </span>
                  )}
                </div>
                {detail.flavorText && (
                  <p className="text-xs italic opacity-50 mt-1">
                    {detail.flavorText}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  className="btn btn-xs btn-ghost"
                  disabled={busy}
                  onClick={toggleLock}
                  title={detail.isLocked ? "Déverrouiller" : "Verrouiller"}
                >
                  {detail.isLocked ? "🔓" : "🔒"}
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setSelectedItem(null)}
                >
                  Fermer
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Statistiques */}
              <div className="flex flex-col gap-1.5">
                <div className="text-xs uppercase tracking-wider opacity-50">
                  Statistiques
                </div>
                {detail.stats.length === 0 ? (
                  <span className="text-xs opacity-50">
                    Aucune statistique exposée.
                  </span>
                ) : (
                  detail.stats.map((s) => (
                    <div key={s.hash} className="flex items-center gap-2.5">
                      <span className="text-[11px] w-24 sm:w-32 opacity-70 truncate">
                        {s.name}
                      </span>
                      <progress
                        className="progress progress-primary h-1.5 flex-1"
                        value={s.value}
                        max={s.max}
                      />
                      <span className="text-[11px] font-mono w-10 text-right tabular-nums">
                        {s.value}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Perks & mods */}
              <div className="flex flex-col gap-3">
                {detail.perkSockets.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider opacity-50 mb-1.5">
                      Perks
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {detail.perkSockets.map((s) => (
                        <div key={s.socketIndex} className="flex gap-1.5 flex-wrap">
                          {s.plugs.map((p) => (
                            <button
                              key={p.hash}
                              disabled={busy}
                              className={`p-0.5 rounded border-2 ${
                                p.active
                                  ? "border-primary"
                                  : "border-transparent hover:border-base-content/30"
                              }`}
                              title={`${p.name}${p.description ? `\n\n${p.description}` : ""}`}
                              onClick={() =>
                                applyPlug(s.socketIndex, p.hash, p.name)
                              }
                            >
                              {p.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`${BUNGIE_ROOT}${p.icon}`}
                                  alt={p.name}
                                  className="w-8 h-8 rounded-full bg-base-300 p-0.5"
                                />
                              ) : (
                                <span className="text-[10px]">{p.name}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-xs uppercase tracking-wider opacity-50 mb-1.5">
                    Mods
                  </div>
                  {detail.modSockets.length === 0 ? (
                    <span className="text-xs opacity-50">
                      Aucun emplacement de mod modifiable.
                    </span>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {detail.modSockets.map((s) => (
                        <div
                          key={s.socketIndex}
                          className="flex gap-1.5 flex-wrap"
                        >
                          {s.plugs.map((p) => (
                            <button
                              key={p.hash}
                              disabled={busy}
                              className={`p-0.5 rounded border-2 ${
                                p.active
                                  ? "border-primary"
                                  : "border-transparent hover:border-base-content/30"
                              }`}
                              title={`${p.name}${p.description ? `\n\n${p.description}` : ""}`}
                              onClick={() =>
                                applyPlug(s.socketIndex, p.hash, p.name)
                              }
                            >
                              {p.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`${BUNGIE_ROOT}${p.icon}`}
                                  alt={p.name}
                                  className="w-8 h-8 rounded"
                                />
                              ) : (
                                <span className="text-[10px]">{p.name}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
