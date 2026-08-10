"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUCKET_SUBCLASS,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_WEAPON,
  SOCKET_CATEGORY_ARMOR_MODS,
  SOCKET_CATEGORY_WEAPON_MODS,
  STAT_CAP,
  TIER_EXOTIC,
  WEAPON_SLOT_ORDER,
  WEAPON_STAT_HASHES,
} from "@/lib/destiny-constants";
import { buildModSockets, type ModSocket } from "@/lib/mod-engine";
import { insertPlug } from "@/lib/d2-actions";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

interface SlotItem {
  bucketHash: number;
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  isExotic: boolean;
  power: number;
  energyCapacity: number;
  isWeapon: boolean;
}

export default function PersoPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-6), m]);
  }

  const fetchProfile = useCallback(async (): Promise<ProfileResponse | null> => {
    const res = await fetch("/api/bungie/profile?scope=mods");
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
      const inst = instances[item.itemInstanceId];
      out.push({
        bucketHash: item.bucketHash,
        instanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        name: def.displayProperties?.name ?? "Objet",
        icon: def.displayProperties?.icon,
        isExotic: def.inventory?.tierType === TIER_EXOTIC,
        power: inst?.primaryStat?.value ?? 0,
        energyCapacity: inst?.energy?.energyCapacity ?? 0,
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

  const selected = equipped.find((i) => i.instanceId === selectedItem) ?? null;

  const sockets: ModSocket[] = useMemo(() => {
    if (!defs || !profile || !selected) return [];
    return buildModSockets({
      defs,
      data: profile,
      instanceId: selected.instanceId,
      itemHash: selected.itemHash,
      categoryHash: selected.isWeapon
        ? SOCKET_CATEGORY_WEAPON_MODS
        : SOCKET_CATEGORY_ARMOR_MODS,
      targetStat: 0,
      relevantStats: selected.isWeapon ? WEAPON_STAT_HASHES : ARMOR_STAT_HASHES,
    });
  }, [defs, profile, selected]);

  async function applyPlug(socketIndex: number, plugHash: number, name: string) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await insertPlug({
        itemId: selected.instanceId,
        characterId: selectedChar,
        socketIndex,
        plugItemHash: plugHash,
      });
      pushLog(`🔧 ${name} posé sur ${selected.name}.`);
      await fetchProfile();
    } catch (e) {
      pushLog(
        `⚠️ ${name} : ${e instanceof Error ? e.message : "refusé (énergie insuffisante ?)"}`
      );
    } finally {
      setBusy(false);
    }
  }

  function ItemTile({ bucket }: { bucket: number }) {
    const item = byBucket.get(bucket);
    if (!item) {
      return (
        <div className="w-14 h-14 rounded bg-base-300/40 border border-base-300" />
      );
    }
    const active = selectedItem === item.instanceId;
    return (
      <button
        className={`relative w-14 h-14 rounded overflow-hidden border-2 transition-all ${
          active
            ? "border-primary scale-105"
            : item.isExotic
              ? "border-[#ceae33] hover:border-primary"
              : "border-base-300 hover:border-primary"
        }`}
        title={`${item.name} — ✦ ${item.power}`}
        onClick={() => setSelectedItem(active ? null : item.instanceId)}
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
      <div className="card bg-base-200 shadow overflow-hidden">
        <div
          className="relative bg-cover bg-center"
          style={
            currentChar?.emblemBackgroundPath
              ? {
                  backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.72), rgba(20,24,31,.94)), url(${BUNGIE_ROOT}${currentChar.emblemBackgroundPath})`,
                }
              : undefined
          }
        >
          <div className="flex items-start justify-center gap-6 md:gap-12 p-6 flex-wrap md:flex-nowrap">
            {/* Armes */}
            <div className="flex flex-col gap-2.5 order-2 md:order-1">
              <div className="mb-1">
                <ItemTile bucket={BUCKET_SUBCLASS} />
              </div>
              {WEAPON_SLOT_ORDER.map((b) => (
                <ItemTile key={b} bucket={b} />
              ))}
            </div>

            {/* Centre */}
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
              <div className="text-xs opacity-60">Équipement : ✦ {gearPower}</div>

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

            {/* Armure */}
            <div className="flex flex-col gap-2.5 order-3">
              {ARMOR_SLOT_ORDER.map((b) => (
                <ItemTile key={b} bucket={b} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Panneau de mods de l'objet sélectionné ── */}
      {selected ? (
        <div className="card bg-base-200 shadow">
          <div className="card-body p-5 gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              {selected.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={`item-icon${selected.isExotic ? " exotic" : ""}`}
                  src={`${BUNGIE_ROOT}${selected.icon}`}
                  alt=""
                />
              )}
              <div>
                <h2 className="card-title text-base">{selected.name}</h2>
                <div className="text-xs opacity-60">
                  {selected.isWeapon ? "Arme" : "Armure"}
                  {selected.power > 0 && ` · ✦ ${selected.power}`}
                  {selected.energyCapacity > 0 &&
                    ` · énergie ${selected.energyCapacity}`}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-xs ml-auto"
                onClick={() => setSelectedItem(null)}
              >
                Fermer
              </button>
            </div>

            {sockets.length === 0 ? (
              <div className="text-sm opacity-60">
                Aucun emplacement de mod modifiable sur cet objet.
              </div>
            ) : (
              sockets.map((s) => (
                <div key={s.socketIndex} className="flex flex-col gap-2">
                  <div className="text-xs uppercase tracking-wider opacity-50">
                    Emplacement {s.socketIndex} — actuel :{" "}
                    <span className="text-primary">
                      {s.currentName ?? "vide"}
                    </span>
                    {s.currentCost > 0 && ` (${s.currentCost} énergie)`}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.options.map((o) => (
                      <button
                        key={o.hash}
                        disabled={busy || !o.canInsert}
                        className={`p-0.5 rounded border-2 transition-colors ${
                          o.hash === s.currentPlugHash
                            ? "border-primary"
                            : "border-transparent hover:border-base-content/30"
                        } ${o.canInsert ? "" : "opacity-30"}`}
                        title={`${o.name}${o.energyCost ? ` — ${o.energyCost} énergie` : ""}${
                          o.description ? `\n\n${o.description}` : ""
                        }`}
                        onClick={() => applyPlug(s.socketIndex, o.hash, o.name)}
                      >
                        {o.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${BUNGIE_ROOT}${o.icon}`}
                            alt={o.name}
                            className="w-9 h-9 rounded"
                          />
                        ) : (
                          <span className="text-[10px] px-1">{o.name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm opacity-50 text-center">
          Clique une arme ou une pièce d&apos;armure pour voir et changer ses
          mods.
        </p>
      )}
    </div>
  );
}
