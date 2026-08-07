"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_WEAPON,
  SOCKET_CATEGORY_WEAPON_MODS,
  SOCKET_CATEGORY_WEAPON_PERKS,
  TIER_EXOTIC,
  WEAPON_BUCKETS,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  buildLocationMap,
  equipItems,
  moveToCharacter,
  transferItem,
  type ItemLocation,
} from "@/lib/d2-actions";
import type {
  Character,
  Defs,
  ProfileItem,
  ProfileResponse,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

interface Plug {
  name: string;
  icon?: string;
}

interface WeaponVM {
  id: string;
  itemHash: number;
  name: string;
  icon?: string;
  typeName: string;
  slot: number;
  tierType: number;
  tierName: string;
  power: number;
  damageName: string;
  damageIcon?: string;
  damageHash: number;
  perks: Plug[];
  mods: Plug[];
}

export default function WeaponsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [weapons, setWeapons] = useState<WeaponVM[]>([]);
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [slotFilter, setSlotFilter] = useState<string>("all");
  const [damageFilter, setDamageFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Récupération de ton arsenal…");
        const res = await fetch("/api/bungie/profile?scope=gear");
        if (res.status === 401) {
          setPhase("unauth");
          return;
        }
        const data = (await res.json()) as ProfileResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur profil");
        if (cancelled) return;
        setProfile(data);
        setWeapons(buildWeapons(data, d));
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
  }, []);

  function buildWeapons(data: ProfileResponse, d: Defs): WeaponVM[] {
    const allItems: ProfileItem[] = [
      ...(data.profileInventory?.data?.items ?? []),
      ...Object.values(data.characterInventories?.data ?? {}).flatMap(
        (inv) => inv.items
      ),
      ...Object.values(data.characterEquipment?.data ?? {}).flatMap(
        (inv) => inv.items
      ),
    ];
    const instances = data.itemComponents?.instances?.data ?? {};
    const socketsData = data.itemComponents?.sockets?.data ?? {};

    const list: WeaponVM[] = [];
    for (const item of allItems) {
      if (!item.itemInstanceId) continue;
      const def = d.items[item.itemHash];
      if (!def || def.itemType !== ITEM_TYPE_WEAPON) continue;
      const slot = def.inventory?.bucketTypeHash ?? 0;
      if (!(slot in WEAPON_BUCKETS)) continue;

      const inst = instances[item.itemInstanceId];
      const damageHash = inst?.damageTypeHash ?? def.defaultDamageTypeHash ?? 0;
      const damageDef = d.damageTypes?.[damageHash];

      const socketStates = socketsData[item.itemInstanceId]?.sockets ?? [];
      const categories = def.sockets?.socketCategories ?? [];
      const collect = (categoryHash: number): Plug[] => {
        const indexes =
          categories.find((c) => c.socketCategoryHash === categoryHash)
            ?.socketIndexes ?? [];
        const plugs: Plug[] = [];
        for (const idx of indexes) {
          const st = socketStates[idx];
          if (!st?.plugHash || st.isVisible === false) continue;
          const plugDef = d.items[st.plugHash];
          const name = plugDef?.displayProperties?.name;
          if (!name || name === "Emplacement vide") continue;
          plugs.push({ name, icon: plugDef?.displayProperties?.icon });
        }
        return plugs;
      };

      list.push({
        id: item.itemInstanceId,
        itemHash: item.itemHash,
        name: def.displayProperties?.name || `Objet ${item.itemHash}`,
        icon: def.displayProperties?.icon,
        typeName: def.itemTypeDisplayName ?? "Arme",
        slot,
        tierType: def.inventory?.tierType ?? 0,
        tierName: def.inventory?.tierTypeName ?? "",
        power: inst?.primaryStat?.value ?? 0,
        damageName: damageDef?.displayProperties?.name ?? "",
        damageIcon: damageDef?.displayProperties?.icon,
        damageHash,
        perks: collect(SOCKET_CATEGORY_WEAPON_PERKS),
        mods: collect(SOCKET_CATEGORY_WEAPON_MODS),
      });
    }

    list.sort((a, b) => {
      const slotDiff =
        WEAPON_SLOT_ORDER.indexOf(a.slot) - WEAPON_SLOT_ORDER.indexOf(b.slot);
      if (slotDiff !== 0) return slotDiff;
      return b.power - a.power;
    });
    return list;
  }

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  const charClassById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of characters) m.set(c.characterId, c.classType);
    return m;
  }, [characters]);

  const locations = useMemo(
    () =>
      profile ? buildLocationMap(profile) : new Map<string, ItemLocation>(),
    [profile]
  );

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-6), m]);
  }

  async function refresh() {
    if (!defs) return;
    const res = await fetch("/api/bungie/profile?scope=gear");
    if (!res.ok) return;
    const data = (await res.json()) as ProfileResponse;
    setProfile(data);
    setWeapons(buildWeapons(data, defs));
  }

  async function handleEquip(w: WeaponVM) {
    if (!selectedChar || busy) return;
    setBusy(true);
    try {
      const ok = await moveToCharacter({
        instanceId: w.id,
        itemHash: w.itemHash,
        name: w.name,
        targetCharId: selectedChar,
        location: locations.get(w.id),
        log: pushLog,
      });
      if (ok) {
        const res = await equipItems({
          itemIds: [w.id],
          characterId: selectedChar,
        });
        const status = res.results[0]?.equipStatus;
        if (status === 1) pushLog(`✅ ${w.name} équipée.`);
        else
          pushLog(
            `⚠️ ${w.name} : non équipée (code ${status} — es-tu en orbite ?)`
          );
      }
      await refresh();
    } catch (e) {
      pushLog(`❌ ${w.name} : ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleVault(w: WeaponVM) {
    if (busy) return;
    const loc = locations.get(w.id);
    if (!loc || loc.characterId === null) return;
    if (loc.equipped) {
      pushLog(`⚠️ ${w.name} : équipée — équipe autre chose d'abord.`);
      return;
    }
    setBusy(true);
    try {
      await transferItem({
        itemReferenceHash: w.itemHash,
        itemId: w.id,
        transferToVault: true,
        characterId: loc.characterId,
      });
      pushLog(`📦 ${w.name} envoyée au coffre.`);
      await refresh();
    } catch (e) {
      pushLog(`❌ ${w.name} : ${e instanceof Error ? e.message : "erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  function holderBadge(w: WeaponVM) {
    const loc = locations.get(w.id);
    if (!loc || loc.characterId === null) {
      return <span className="badge badge-sm badge-ghost">Coffre</span>;
    }
    const cls = CLASS_NAMES[charClassById.get(loc.characterId) ?? -1] ?? "Perso";
    if (loc.equipped) {
      return (
        <span className="badge badge-sm badge-primary">Équipée · {cls}</span>
      );
    }
    return <span className="badge badge-sm badge-outline">{cls}</span>;
  }

  const damageOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const w of weapons) {
      if (w.damageHash && w.damageName) m.set(w.damageHash, w.damageName);
    }
    return [...m.entries()];
  }, [weapons]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return weapons.filter((w) => {
      if (slotFilter !== "all" && w.slot !== Number(slotFilter)) return false;
      if (damageFilter !== "all" && w.damageHash !== Number(damageFilter))
        return false;
      if (tierFilter === "exotic" && w.tierType !== TIER_EXOTIC) return false;
      if (tierFilter === "legendary" && w.tierType === TIER_EXOTIC)
        return false;
      if (!f) return true;
      return (
        w.name.toLowerCase().includes(f) ||
        w.typeName.toLowerCase().includes(f) ||
        w.perks.some((p) => p.name.toLowerCase().includes(f))
      );
    });
  }, [weapons, filter, slotFilter, damageFilter, tierFilter]);

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
        <p className="opacity-70">Connecte-toi pour voir ton arsenal.</p>
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

  const activeClass =
    CLASS_NAMES[charClassById.get(selectedChar) ?? -1] ?? "ton personnage";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Arsenal</h1>
        <span className="badge badge-ghost">
          {shown.length}/{weapons.length} armes
        </span>
      </div>

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
            onClick={() => setSelectedChar(c.characterId)}
          >
            <div className="char-class">
              {CLASS_NAMES[c.classType] ?? "Gardien"}
            </div>
            <div className="char-light">✦ {c.light}</div>
          </button>
        ))}
      </div>

      <div role="alert" className="alert alert-info py-2 text-sm">
        <span>
          Les équipements et transferts visent <strong>{activeClass}</strong>.
          La recherche couvre aussi les noms de perks.
        </span>
      </div>

      {log.length > 0 && (
        <div className="action-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div role="tablist" className="tabs tabs-boxed tabs-sm">
          <a
            role="tab"
            className={`tab${slotFilter === "all" ? " tab-active" : ""}`}
            onClick={() => setSlotFilter("all")}
          >
            Tous
          </a>
          {WEAPON_SLOT_ORDER.map((s) => (
            <a
              key={s}
              role="tab"
              className={`tab${slotFilter === String(s) ? " tab-active" : ""}`}
              onClick={() => setSlotFilter(String(s))}
            >
              {WEAPON_BUCKETS[s]}
            </a>
          ))}
        </div>
        <select
          className="select select-bordered select-sm"
          value={damageFilter}
          onChange={(e) => setDamageFilter(e.target.value)}
        >
          <option value="all">Tous les éléments</option>
          {damageOptions.map(([hash, name]) => (
            <option key={hash} value={hash}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-sm"
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
        >
          <option value="all">Toutes raretés</option>
          <option value="exotic">Exotiques</option>
          <option value="legendary">Non exotiques</option>
        </select>
        <input
          className="input input-bordered input-sm w-64"
          placeholder="Filtrer par nom, type, perk…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body p-2">
          <div className="overflow-x-auto">
            <table className="table table-zebra table-pin-rows table-sm min-w-[1000px]">
              <thead>
                <tr>
                  <th>Arme</th>
                  <th>Type</th>
                  <th>Élément</th>
                  <th className="text-right">Puissance</th>
                  <th>Perks</th>
                  <th>Mods</th>
                  <th>Détenue par</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center opacity-60 py-8">
                      Aucune arme ne correspond.
                    </td>
                  </tr>
                ) : (
                  shown.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          {w.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={`item-icon !w-10 !h-10${
                                w.tierType === TIER_EXOTIC ? " exotic" : ""
                              }`}
                              src={`${BUNGIE_ROOT}${w.icon}`}
                              alt=""
                            />
                          ) : (
                            <div className="item-icon !w-10 !h-10" />
                          )}
                          <span className="font-medium whitespace-nowrap">
                            {w.name}
                          </span>
                          {w.tierType === TIER_EXOTIC && (
                            <span className="badge badge-xs badge-primary">
                              exotique
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs opacity-60 uppercase whitespace-nowrap">
                        {w.typeName}
                      </td>
                      <td className="whitespace-nowrap">
                        {w.damageIcon && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="damage-icon"
                            src={`${BUNGIE_ROOT}${w.damageIcon}`}
                            alt=""
                          />
                        )}
                        <span className="text-xs">{w.damageName}</span>
                      </td>
                      <td className="text-right font-mono">
                        {w.power > 0 ? w.power : "—"}
                      </td>
                      <td>
                        <div className="flex gap-1 flex-wrap max-w-52">
                          {w.perks.map((p, i) => (
                            <span className="plug" key={i} title={p.name}>
                              {p.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`${BUNGIE_ROOT}${p.icon}`}
                                  alt={p.name}
                                />
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="text-xs opacity-60 max-w-40">
                        {w.mods.map((m) => m.name).join(" · ")}
                      </td>
                      <td>{holderBadge(w)}</td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex gap-1 justify-end">
                          <button
                            className="btn btn-xs btn-primary"
                            disabled={busy || !selectedChar}
                            onClick={() => handleEquip(w)}
                          >
                            Équiper
                          </button>
                          {locations.get(w.id)?.characterId !== null &&
                            !locations.get(w.id)?.equipped && (
                              <button
                                className="btn btn-xs btn-outline"
                                disabled={busy}
                                onClick={() => handleVault(w)}
                              >
                                Coffre
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs opacity-50">
        Survole une icône de perk pour voir son nom. Les objets équipés sur un
        autre personnage doivent être déséquipés en jeu avant transfert.
      </p>
    </div>
  );
}
