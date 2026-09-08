"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUCKET_SUBCLASS,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_ARMOR,
  ITEM_TYPE_WEAPON,
  STAT_CAP,
  TIER_EXOTIC,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  buildLocationMap,
  equipItems,
  insertPlug,
  moveToCharacter,
  setLocked,
  type ItemLocation,
} from "@/lib/d2-actions";
import { buildItemDetail, type ItemDetail } from "@/lib/item-detail";
import type {
  Character,
  Defs,
  ProfileItem,
  ProfileResponse,
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
  name: string;
  icon?: string;
  power: number;
  isExotic: boolean;
  where: string;
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

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-8), m]);
  }

  const fetchProfile = useCallback(async (): Promise<ProfileResponse | null> => {
    const res = await fetch("/api/bungie/profile?scope=perso");
    if (res.status === 401) {
      setPhase("unauth");
      return null;
    }
    const data = (await res.json()) as ProfileResponse & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Erreur profil");
    setProfile(data);
    return data;
  }, []);

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

  const gearPower = useMemo(() => {
    const gear = [...WEAPON_SLOT_ORDER, ...ARMOR_SLOT_ORDER]
      .map((b) => byBucket.get(b)?.power ?? 0)
      .filter((p) => p > 0);
    if (gear.length === 0) return 0;
    return Math.floor(gear.reduce((a, v) => a + v, 0) / gear.length);
  }, [byBucket]);

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
      if (ok) {
        const res = await equipItems({
          itemIds: [c.instanceId],
          characterId: selectedChar,
        });
        const status = res.results[0]?.equipStatus;
        if (status === 1) pushLog(`✅ ${c.name} équipé.`);
        else
          pushLog(
            `⚠️ ${c.name} : non équipé (code ${status} — es-tu en orbite ?)`
          );
      }
      await fetchProfile();
    } catch (e) {
      pushLog(`❌ ${c.name} : ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyPlug(socketIndex: number, plugHash: number, name: string) {
    if (!detail || busy) return;
    setBusy(true);
    try {
      await insertPlug({
        itemId: detail.instanceId,
        characterId: selectedChar,
        socketIndex,
        plugItemHash: plugHash,
      });
      pushLog(`🔧 ${name} posé sur ${detail.name}.`);
      await fetchProfile();
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
      pushLog(
        detail.isLocked
          ? `🔓 ${detail.name} déverrouillé.`
          : `🔒 ${detail.name} verrouillé.`
      );
      await fetchProfile();
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
        onMouseEnter={() => swappable && openHover(bucket)}
        onMouseLeave={closeHoverSoon}
      >
        {item ? (
          <button
            className={`relative w-14 h-14 rounded overflow-hidden border-2 transition-all ${
              selectedItem === item.instanceId
                ? "border-primary scale-105"
                : item.isExotic
                  ? "border-[#ceae33] hover:border-primary"
                  : "border-base-300 hover:border-primary"
            }`}
            title={`${item.name} — ✦ ${item.power}`}
            onClick={() =>
              setSelectedItem(
                selectedItem === item.instanceId ? null : item.instanceId
              )
            }
          >
            {item.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${BUNGIE_ROOT}${item.icon}`}
                alt={item.name}
                className="w-full h-full"
              />
            )}
            {item.power > 0 && (
              <span className="absolute bottom-0 right-0 bg-black/75 text-[10px] font-mono px-1 text-[#ffd970]">
                {item.power}
              </span>
            )}
          </button>
        ) : (
          <div className="w-14 h-14 rounded bg-base-300/40 border border-base-300" />
        )}

        {open && swappable && (
          <div
            className={`absolute top-0 z-30 w-64 max-h-80 overflow-y-auto bg-base-300 border border-primary/40 rounded-box shadow-xl p-2 ${
              side === "left" ? "left-16" : "right-16"
            }`}
            onMouseEnter={() => openHover(bucket)}
            onMouseLeave={closeHoverSoon}
          >
            <div className="text-[11px] uppercase tracking-wider opacity-60 px-1 pb-1">
              Changer — {candidates.length} disponibles
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
                  className="flex items-center gap-2 w-full text-left rounded px-1 py-1 hover:bg-base-100 disabled:opacity-40"
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
      <div className="flex gap-2.5 flex-wrap">
        {characters.map((c) => (
          <button
            key={c.characterId}
            className={`char-btn${selectedChar === c.characterId ? " active" : ""}`}
            style={
              c.emblemBackgroundPath
                ? {
                    backgroundImage: `url(${BUNGIE_ROOT}${c.emblemBackgroundPath})`,
                  }
                : undefined
            }
            onClick={() => {
              setSelectedChar(c.characterId);
              setSelectedItem(null);
            }}
          >
            <div className="char-class">
              {CLASS_NAMES[c.classType] ?? "Gardien"}
            </div>
            <div className="char-light">✦ {c.light}</div>
          </button>
        ))}
      </div>

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* ── Écran personnage ── */}
      <div className="card bg-base-200 shadow overflow-visible">
        <div
          className="relative bg-cover bg-center rounded-box"
          style={
            currentChar?.emblemBackgroundPath
              ? {
                  backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.72), rgba(20,24,31,.94)), url(${BUNGIE_ROOT}${currentChar.emblemBackgroundPath})`,
                }
              : undefined
          }
        >
          <div className="flex items-start justify-center gap-6 md:gap-12 p-6 flex-wrap md:flex-nowrap">
            <div className="flex flex-col gap-2.5 order-2 md:order-1">
              <div className="mb-1">
                <ItemTile bucket={BUCKET_SUBCLASS} side="left" />
              </div>
              {WEAPON_SLOT_ORDER.map((b) => (
                <ItemTile key={b} bucket={b} side="left" />
              ))}
            </div>

            <div className="flex flex-col items-center gap-3 order-1 md:order-2 min-w-56 py-2">
              <div className="text-xs tracking-[0.3em] uppercase opacity-60">
                {CLASS_NAMES[currentChar?.classType ?? 0]}
              </div>
              <div className="flex items-start gap-1">
                <span className="text-[#ffd970] text-2xl leading-none mt-2">
                  ✦
                </span>
                <span className="text-6xl font-light text-[#ffd970] leading-none">
                  {currentChar?.light ?? 0}
                </span>
              </div>
              <div className="text-[10px] tracking-[0.25em] uppercase opacity-50">
                Puissance
              </div>
              <div className="text-xs opacity-60">
                Équipement : ✦ {gearPower}
              </div>

              <div className="w-full flex flex-col gap-1.5 mt-2">
                {ARMOR_STAT_HASHES.map((h, i) => {
                  const v = currentChar?.stats?.[String(h)] ?? 0;
                  return (
                    <div key={h} className="flex items-center gap-2">
                      <span className="text-[11px] w-20 opacity-70 truncate">
                        {statNames[i]}
                      </span>
                      <progress
                        className="progress progress-primary h-1.5 flex-1"
                        value={v}
                        max={STAT_CAP}
                      />
                      <span className="text-[11px] font-mono w-8 text-right">
                        {v}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 order-3">
              {ARMOR_SLOT_ORDER.map((b) => (
                <ItemTile key={b} bucket={b} side="right" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs opacity-50 text-center">
        Survole un emplacement pour changer d&apos;arme ou de pièce
        d&apos;armure · clique pour voir le détail complet.
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
          <div className="card-body p-5 gap-4">
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
                      <span className="text-[11px] w-32 opacity-70 truncate">
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
                        <div key={s.socketIndex} className="flex gap-1.5">
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
