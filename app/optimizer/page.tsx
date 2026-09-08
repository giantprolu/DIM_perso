"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import ModsPanel from "@/components/ModsPanel";
import {
  ARMOR_MOD_CATEGORY,
  bestModCombo,
  buildItemModContext,
  verifySockets,
  type StatWeights,
} from "@/lib/mod-engine";
import { applyModCombo } from "@/lib/mod-apply";
import {
  ARMOR_BUCKETS,
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_ARMOR,
  STAT_CAP,
  TIER_EXOTIC,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  computeBestBuilds,
  computeBestPowerBuilds,
  type Build,
  type EnginePiece,
  type PowerBuild,
  type PowerPiece,
} from "@/lib/optimizer-engine";
import {
  buildLocationMap,
  equipItems,
  fetchItemSockets,
  fetchProfileFresh,
  moveToCharacter,
  sleep,
} from "@/lib/d2-actions";
import {
  captureEquippedLoadout,
  loadLoadouts,
  persistLoadouts,
} from "@/lib/loadouts";
import type {
  Character,
  Defs,
  ProfileItem,
  ProfileResponse,
  SocketState,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

interface ArmorPiece extends EnginePiece {
  name: string;
  icon?: string;
  classType: number;
  displayedStats: number[];
  baseStats: number[];
  power: number;
}

/** Somme des Puissances des objets équipés d'un personnage, sur les buckets donnés. */
function equippedPowerSum(
  profile: ProfileResponse,
  defs: Defs,
  charId: string,
  buckets: number[]
): number {
  const bucketSet = new Set(buckets);
  const instances = profile.itemComponents?.instances?.data ?? {};
  const items = profile.characterEquipment?.data?.[charId]?.items ?? [];
  let sum = 0;
  for (const item of items) {
    const def = defs.items[item.itemHash];
    const slot = def?.inventory?.bucketTypeHash;
    if (slot === undefined || !bucketSet.has(slot)) continue;
    const power = item.itemInstanceId
      ? (instances[item.itemInstanceId]?.primaryStat?.value ?? 0)
      : 0;
    sum += power;
  }
  return sum;
}

const MOD_COUNT = 5;
const MOD_VALUE = 10;

/** Une ligne du tableau Puissance : l'assemblage + son plan de mods d'équilibrage. */
interface PowerRow {
  pb: PowerBuild;
  base: number[];
  mods: number[];
  finalTotals: number[];
}

/**
 * Règle d'équilibrage sans réglage : chaque mod +10 va sur la stat la plus
 * basse encore sous le plafond. Renvoie 6 compteurs de mods (total = count).
 */
function balanceStatMods(totals: number[], count: number): number[] {
  const mods = [0, 0, 0, 0, 0, 0];
  const work = [...totals];
  for (let k = 0; k < count; k++) {
    let idx = -1;
    for (let i = 0; i < 6; i++) {
      if (work[i] + MOD_VALUE > STAT_CAP) continue;
      if (idx === -1 || work[i] < work[idx]) idx = i;
    }
    // Toutes les stats sont au plafond : on relève quand même la plus basse.
    if (idx === -1) {
      for (let i = 0; i < 6; i++) {
        if (idx === -1 || work[i] < work[idx]) idx = i;
      }
    }
    work[idx] += MOD_VALUE;
    mods[idx] += 1;
  }
  return mods;
}

const WEIGHT_OPTIONS = [
  { v: 0, label: "Ign" },
  { v: 1, label: "×1" },
  { v: 2, label: "×2" },
  { v: 3, label: "×3" },
];

/**
 * Stats de base ≈ stats affichées − contribution des mods amovibles
 * (plugs dont la catégorie commence par "enhancements.").
 */
function computeBaseStats(
  displayed: number[],
  sockets: SocketState[] | undefined,
  defs: Defs
): number[] {
  if (!sockets) return displayed;
  const out = [...displayed];
  for (const s of sockets) {
    if (!s.plugHash || s.isEnabled === false) continue;
    const plugDef = defs.items[s.plugHash];
    const category = plugDef?.plug?.plugCategoryIdentifier ?? "";
    if (!category.startsWith("enhancements.")) continue;
    for (const inv of plugDef?.investmentStats ?? []) {
      const idx = ARMOR_STAT_HASHES.indexOf(inv.statTypeHash);
      if (idx >= 0) out[idx] = Math.max(0, out[idx] - inv.value);
    }
  }
  return out;
}

export default function OptimizerPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [pieces, setPieces] = useState<ArmorPiece[]>([]);
  const [selectedClass, setSelectedClass] = useState<number>(-1);
  const [exoticHash, setExoticHash] = useState<string>("none");
  const [weights, setWeights] = useState<number[]>([1, 1, 1, 1, 1, 1]);
  const [minimums, setMinimums] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [useBaseStats, setUseBaseStats] = useState(true);
  const [simulateMods, setSimulateMods] = useState(true);
  const [keepPower, setKeepPower] = useState(true);
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [selBuild, setSelBuild] = useState(0);
  const [powerBuilds, setPowerBuilds] = useState<PowerBuild[] | null>(null);
  const [computingPower, setComputingPower] = useState(false);
  const [powerError, setPowerError] = useState("");
  const detailRef = useRef<HTMLDivElement | null>(null);

  function selectBuild(rank: number) {
    setSelBuild(rank);
    // Amène la carte Détail à l'écran pour un retour visuel immédiat
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }
  const [computing, setComputing] = useState(false);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [targetChar, setTargetChar] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [saveAsLoadout, setSaveAsLoadout] = useState(true);
  const [mainTab, setMainTab] = useState<"builds" | "mods">("builds");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Récupération de ton arsenal (coffre + personnages)…");
        const res = await fetch("/api/bungie/profile?scope=gear");
        if (res.status === 401) {
          setPhase("unauth");
          return;
        }
        const data = (await res.json()) as ProfileResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur profil");
        if (cancelled) return;
        setProfile(data);

        const allItems: ProfileItem[] = [
          ...(data.profileInventory?.data?.items ?? []),
          ...Object.values(data.characterInventories?.data ?? {}).flatMap(
            (inv) => inv.items
          ),
          ...Object.values(data.characterEquipment?.data ?? {}).flatMap(
            (inv) => inv.items
          ),
        ];

        const statsData = data.itemComponents?.stats?.data ?? {};
        const socketsData = data.itemComponents?.sockets?.data ?? {};
        const instancesData = data.itemComponents?.instances?.data ?? {};
        const pool: ArmorPiece[] = [];

        for (const item of allItems) {
          if (!item.itemInstanceId) continue;
          const def = d.items[item.itemHash];
          if (!def || def.itemType !== ITEM_TYPE_ARMOR) continue;
          const slot = def.inventory?.bucketTypeHash ?? 0;
          if (!(slot in ARMOR_BUCKETS)) continue;

          const instStats = statsData[item.itemInstanceId]?.stats;
          const displayedStats = ARMOR_STAT_HASHES.map(
            (h) => instStats?.[h]?.value ?? 0
          );
          const baseStats = computeBaseStats(
            displayedStats,
            socketsData[item.itemInstanceId]?.sockets,
            d
          );

          pool.push({
            id: item.itemInstanceId,
            itemHash: item.itemHash,
            slot,
            isExotic: def.inventory?.tierType === TIER_EXOTIC,
            stats: baseStats,
            displayedStats,
            baseStats,
            power: instancesData[item.itemInstanceId]?.primaryStat?.value ?? 0,
            name: def.displayProperties?.name || `Objet ${item.itemHash}`,
            icon: def.displayProperties?.icon,
            classType: def.classType,
          });
        }

        setPieces(pool);
        const chars = Object.values(data.characters?.data ?? {});
        chars.sort(
          (a, b) =>
            new Date(b.dateLastPlayed).getTime() -
            new Date(a.dateLastPlayed).getTime()
        );
        setSelectedClass(chars[0]?.classType ?? 0);
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

  const classPieces = useMemo(
    () => pieces.filter((p) => p.classType === selectedClass),
    [pieces, selectedClass]
  );

  const exotics = useMemo(() => {
    const byHash = new Map<number, ArmorPiece>();
    for (const p of classPieces) {
      if (p.isExotic && !byHash.has(p.itemHash)) byHash.set(p.itemHash, p);
    }
    return [...byHash.values()].sort((a, b) => {
      const slotDiff =
        ARMOR_SLOT_ORDER.indexOf(a.slot) - ARMOR_SLOT_ORDER.indexOf(b.slot);
      return slotDiff !== 0 ? slotDiff : a.name.localeCompare(b.name, "fr");
    });
  }, [classPieces]);

  const pieceById = useMemo(() => {
    const m = new Map<string, ArmorPiece>();
    for (const p of pieces) m.set(p.id, p);
    return m;
  }, [pieces]);

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  const classChars = useMemo(
    () => characters.filter((c) => c.classType === selectedClass),
    [characters, selectedClass]
  );

  /**
   * Puissance d'équipement du personnage cible : moyenne des 8 objets
   * équipés (3 armes + 5 pièces d'armure). C'est cette valeur que les
   * assemblages ne doivent jamais faire baisser.
   */
  const powerContext = useMemo(() => {
    const empty = { weaponsPower: 0, weaponsCount: 0, current: 0 };
    if (!profile || !targetChar) return empty;
    const equipped =
      profile.characterEquipment?.data?.[targetChar]?.items ?? [];
    const instances = profile.itemComponents?.instances?.data ?? {};
    let weaponsPower = 0;
    let weaponsCount = 0;
    let armorPower = 0;
    let armorCount = 0;
    for (const item of equipped) {
      if (!item.itemInstanceId) continue;
      const power = instances[item.itemInstanceId]?.primaryStat?.value ?? 0;
      if (power <= 0) continue;
      if (WEAPON_SLOT_ORDER.includes(item.bucketHash)) {
        weaponsPower += power;
        weaponsCount++;
      } else if (ARMOR_SLOT_ORDER.includes(item.bucketHash)) {
        armorPower += power;
        armorCount++;
      }
    }
    const total = weaponsCount + armorCount;
    return {
      weaponsPower,
      weaponsCount,
      current: total > 0 ? Math.floor((weaponsPower + armorPower) / total) : 0,
    };
  }, [profile, targetChar]);

  useEffect(() => {
    if (classChars.length > 0) setTargetChar(classChars[0].characterId);
    else setTargetChar("");
  }, [classChars]);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-40), m]);
  }

  async function applyBuild(b: Build, withMods: boolean, nameOverride?: string) {
    if (!defs || !targetChar || busy) return;
    setBusy(true);
    setLog([]);
    pushLog("▶️ Application de l'assemblage…");
    try {
      const fresh = await fetchProfileFresh("gear");
      setProfile(fresh);
      const locations = buildLocationMap(fresh);

      const toEquip: string[] = [];
      for (const id of b.pieceIds) {
        const piece = pieceById.get(id);
        if (!piece) continue;
        const ok = await moveToCharacter({
          instanceId: id,
          itemHash: piece.itemHash,
          name: piece.name,
          targetCharId: targetChar,
          location: locations.get(id),
          log: pushLog,
        });
        if (ok) toEquip.push(id);
      }

      if (toEquip.length > 0) {
        pushLog(`🎽 Équipement de ${toEquip.length} pièces…`);
        const eq = await equipItems({
          itemIds: toEquip,
          characterId: targetChar,
        });
        for (const r of eq.results) {
          if (r.equipStatus !== 1) {
            const name =
              pieceById.get(r.itemInstanceId)?.name ?? r.itemInstanceId;
            pushLog(
              `⚠️ ${name} : non équipée (code ${r.equipStatus} — es-tu en orbite ?)`
            );
          }
        }
        await sleep(300);
      }

      if (withMods) {
        /*
         * Bungie refuse d'écrire sur un objet dont l'état vient de changer
         * (« Refresh the item and try again »). On laisse l'équipement se
         * propager, puis on repart d'un profil frais incluant le composant
         * 310 : c'est lui qui dit quels mods CE joueur peut poser sur CET
         * objet, au lieu de deviner depuis le manifest.
         */
        pushLog("⏳ Rafraîchissement de l'équipement avant la pose des mods…");
        await sleep(1800);

        let modsData: ProfileResponse | null = null;
        try {
          modsData = await fetchProfileFresh("equipped");
        } catch {
          pushLog("⚠️ Profil illisible : pose des mods abandonnée.");
        }

        if (modsData) {
          /*
           * L'assemblage a été calculé en supposant `b.mods` mods de +10,
           * répartis par stat. On ne se limite plus à un mod par pièce : le
           * solveur remplit TOUS les emplacements modifiables de chaque
           * pièce, sous contrainte du budget d'énergie et de l'unicité d'un
           * mod sur une même pièce. Les besoins encore à couvrir orientent
           * les priorités, pièce après pièce.
           */
          const remaining = [...b.mods];
          const instances = modsData.itemComponents?.instances?.data ?? {};
          let applied = 0;
          let failed = 0;
          const toVerify: {
            instanceId: string;
            name: string;
            expected: { socketIndex: number; plugHash: number; name: string }[];
          }[] = [];

          for (const id of b.pieceIds) {
            const piece = pieceById.get(id);
            if (!piece) continue;

            const statWeights: StatWeights = {};
            ARMOR_STAT_HASHES.forEach((h, i) => {
              // Priorité forte aux stats que l'assemblage compte encore
              // combler, appoint pour celles que tu valorises par ailleurs.
              statWeights[h] = remaining[i] > 0 ? 10 : weights[i] > 0 ? 1 : 0;
            });

            const context = buildItemModContext({
              defs,
              data: modsData,
              instanceId: id,
              itemHash: piece.itemHash,
              categoryHash: ARMOR_MOD_CATEGORY,
              relevantStats: ARMOR_STAT_HASHES,
              characterId: targetChar,
              energyCapacity: instances[id]?.energy?.energyCapacity ?? 0,
              energyUsed: instances[id]?.energy?.energyUsed,
            });

            if (context.sockets.length === 0) {
              pushLog(
                `⚠️ ${piece.name} : aucun emplacement de mod modifiable depuis le web.`
              );
              continue;
            }

            const combo = bestModCombo({ context, weights: statWeights });
            if (combo.changes.length === 0) {
              pushLog(`✔️ ${piece.name} : mods déjà optimaux.`);
              continue;
            }

            const report = await applyModCombo({
              defs,
              instanceId: id,
              characterId: targetChar,
              itemName: piece.name,
              changes: combo.changes,
              sockets: context.sockets,
              log: pushLog,
            });
            applied += report.applied;
            failed += report.failed;

            const unconfirmed = report.outcomes
              .filter((o) => o.status === "incertain")
              .map((o) => ({
                socketIndex: o.choice.socketIndex,
                plugHash: o.choice.plugHash,
                name: o.choice.name,
              }));
            if (unconfirmed.length > 0) {
              toVerify.push({
                instanceId: id,
                name: piece.name,
                expected: unconfirmed,
              });
            }

            // Ce que la pièce a réellement apporté vient en déduction du plan
            for (const o of report.outcomes) {
              if (o.status === "échec") continue;
              for (const e of o.choice.effects) {
                const idx = ARMOR_STAT_HASHES.indexOf(e.statHash);
                if (idx >= 0 && e.value > 0) {
                  remaining[idx] = Math.max(
                    0,
                    remaining[idx] - Math.round(e.value / MOD_VALUE)
                  );
                }
              }
            }
          }

          // Filet de sécurité, uniquement pour ce que Bungie n'a pas confirmé.
          // On relit les pièces concernées une par une (GetItem) : quelques
          // kilo-octets au lieu du profil entier.
          if (toVerify.length > 0) {
            await sleep(1200);
            for (const v of toVerify) {
              try {
                const sockets = await fetchItemSockets(v.instanceId);
                const { ok, missing } = verifySockets(sockets, v.expected);
                applied += ok;
                failed += missing.length;
                if (missing.length > 0) {
                  pushLog(
                    `⚠️ ${v.name} : ${missing.join(", ")} non posé(s) en jeu.`
                  );
                }
              } catch {
                pushLog(`⚠️ ${v.name} : vérification impossible.`);
              }
            }
          }

          pushLog(
            failed === 0
              ? `🔧 ${applied} mod${applied > 1 ? "s" : ""} confirmé${applied > 1 ? "s" : ""} en jeu.`
              : `🔧 ${applied} posé(s), ${failed} refusé(s).`
          );
        }
      }

      if (saveAsLoadout) {
        pushLog("💾 Enregistrement du loadout…");
        await sleep(300);
        let finalProfile: ProfileResponse | null = null;
        try {
          finalProfile = await fetchProfileFresh("gear");
        } catch {
          finalProfile = null;
        }
        if (finalProfile) {
          setProfile(finalProfile);
          const total = b.totals.reduce((a, v) => a + v, 0);
          const exoticName =
            b.pieceIds
              .map((id) => pieceById.get(id))
              .find((p) => p?.isExotic)?.name ?? "légendaire";
          const loadout = captureEquippedLoadout(
            defs,
            finalProfile,
            targetChar,
            selectedClass,
            nameOverride ??
              `Optimiseur · ${CLASS_NAMES[selectedClass]} · ${exoticName} · ${total} pts`
          );
          persistLoadouts([loadout, ...loadLoadouts()]);
          pushLog(
            `💾 Loadout « ${loadout.name} » enregistré — retrouve-le dans l'onglet Loadouts.`
          );
        } else {
          pushLog("⚠️ Loadout non enregistré (profil illisible après équipement).");
        }
      }
      pushLog("✅ Terminé — ton personnage aura cet équipement en jeu.");
    } catch (e) {
      pushLog(`❌ ${e instanceof Error ? e.message : "Erreur"}`);
    } finally {
      setBusy(false);
    }
  }

  const statNames = useMemo(
    () =>
      ARMOR_STAT_HASHES.map(
        (h) => defs?.stats[h]?.displayProperties?.name ?? `Stat ${h}`
      ),
    [defs]
  );

  function run() {
    setComputing(true);
    setBuilds(null);
    setSelBuild(0);
    setTimeout(() => {
      const enginePieces = classPieces.map((p) => ({
        ...p,
        stats: useBaseStats ? p.baseStats : p.displayedStats,
      }));
      const result = computeBestBuilds({
        pieces: enginePieces,
        weights,
        minimums,
        exoticHash: exoticHash === "none" ? null : Number(exoticHash),
        simulateMods,
        otherGearPower: powerContext.weaponsPower,
        otherGearCount: powerContext.weaponsCount,
        minGearPower: keepPower ? powerContext.current : 0,
      });
      setBuilds(result);
      setComputing(false);
    }, 30);
  }

  const currentLight = useMemo(
    () => characters.find((c) => c.characterId === targetChar)?.light ?? 0,
    [characters, targetChar]
  );

  function runPower() {
    if (!profile || !defs || !targetChar) return;
    setComputingPower(true);
    setPowerBuilds(null);
    setPowerError("");
    setTimeout(() => {
      const fixedWeaponPower = equippedPowerSum(
        profile,
        defs,
        targetChar,
        WEAPON_SLOT_ORDER
      );
      const currentArmorPower = equippedPowerSum(
        profile,
        defs,
        targetChar,
        ARMOR_SLOT_ORDER
      );
      const offset =
        currentLight - Math.floor((fixedWeaponPower + currentArmorPower) / 8);
      const armorPieces: PowerPiece[] = classPieces.map((p) => ({
        id: p.id,
        itemHash: p.itemHash,
        slot: p.slot,
        isExotic: p.isExotic,
        power: p.power,
      }));
      const result = computeBestPowerBuilds(
        { armorPieces, fixedWeaponPower, offset },
        5
      );
      const kept = result.filter((b) => b.totalPower >= currentLight);
      if (kept.length === 0) {
        setPowerError(
          "Impossible de calculer un assemblage légal avec ton armure actuelle."
        );
      }
      setPowerBuilds(kept);
      setComputingPower(false);
    }, 30);
  }

  const powerRows: PowerRow[] = useMemo(() => {
    if (!powerBuilds) return [];
    return powerBuilds.map((pb) => {
      const base = [0, 0, 0, 0, 0, 0];
      for (const id of pb.pieceIds) {
        const p = pieceById.get(id);
        if (!p) continue;
        const stats = useBaseStats ? p.baseStats : p.displayedStats;
        stats.forEach((v, i) => (base[i] += v));
      }
      const mods = balanceStatMods(base, MOD_COUNT);
      const finalTotals = base.map((v, i) =>
        Math.min(STAT_CAP, v + mods[i] * MOD_VALUE)
      );
      return { pb, base, mods, finalTotals };
    });
  }, [powerBuilds, pieceById, useBaseStats]);

  async function equipPowerBuild(row: PowerRow, withMods: boolean) {
    const { pb, base, mods, finalTotals } = row;
    const exoticName =
      pb.pieceIds.map((id) => pieceById.get(id)).find((p) => p?.isExotic)?.name ??
      "légendaire";
    await applyBuild(
      {
        pieceIds: pb.pieceIds,
        totals: withMods ? finalTotals : base,
        mods: withMods ? mods : [0, 0, 0, 0, 0, 0],
        score: pb.totalPower,
        power: pb.totalPower,
      },
      withMods,
      `Puissance · ${CLASS_NAMES[selectedClass]} · ${exoticName} · ✦ ${pb.totalPower}`
    );
    // La Puissance actuelle vient de changer : on invalide la liste pour ne
    // jamais proposer un assemblage désormais inférieur au nouveau score.
    setPowerBuilds(null);
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
        <p className="opacity-70">Connecte-toi pour utiliser l&apos;optimiseur.</p>
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

  const sel = builds && builds.length > 0 ? builds[Math.min(selBuild, builds.length - 1)] : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Optimiseur</h1>
        <div className="flex items-center gap-2">
          {powerContext.current > 0 && (
            <span className="badge badge-outline text-[#ffd970]">
              ✦ {powerContext.current} actuel
            </span>
          )}
          <span className="badge badge-ghost">
            {classPieces.length} pièces analysées
          </span>
        </div>
      </div>

      <div role="tablist" className="tabs tabs-boxed w-fit">
        <a
          role="tab"
          className={`tab${mainTab === "builds" ? " tab-active" : ""}`}
          onClick={() => setMainTab("builds")}
        >
          🛡️ Assemblages &amp; puissance
        </a>
        <a
          role="tab"
          className={`tab${mainTab === "mods" ? " tab-active" : ""}`}
          onClick={() => setMainTab("mods")}
        >
          🔧 Mods
        </a>
      </div>

      {mainTab === "mods" && <ModsPanel />}

      {mainTab === "builds" && (
      <>
      <div className="card bg-base-200 shadow border border-primary/30">
        <div className="card-body gap-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="card-title text-base">
              ⚡ Optimiser ma Puissance
            </h2>
            {targetChar && (
              <span className="badge badge-ghost">
                Actuellement ✦ {currentLight}
              </span>
            )}
          </div>
          <p className="text-sm opacity-70">
            Aucun réglage : on cherche, parmi ton armure possédée (
            {CLASS_NAMES[selectedClass]}), l&apos;assemblage 5 pièces (1
            exotique max) qui maximise ta Puissance totale. Tes armes
            équipées ne sont pas changées. Résultat toujours ≥ à ta
            Puissance actuelle. Les 5 mods +10 sont posés en{" "}
            <strong>équilibrage</strong> (sur tes stats les plus basses) — ils
            n&apos;affectent pas la Puissance mais complètent le build.
          </p>

          {!targetChar ? (
            <div role="alert" className="alert alert-warning text-sm">
              <span>
                Choisis un personnage cible ci-dessous (panneau Réglages)
                pour lancer le calcul.
              </span>
            </div>
          ) : (
            <button
              className="btn btn-primary btn-sm w-fit"
              onClick={runPower}
              disabled={computingPower || classPieces.length === 0}
            >
              {computingPower ? "Calcul…" : "Calculer ma meilleure Puissance"}
            </button>
          )}

          {powerError && (
            <div role="alert" className="alert alert-error text-sm">
              <span>{powerError}</span>
            </div>
          )}

          {powerRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm min-w-[680px]">
                <thead>
                  <tr>
                    <th className="w-10">Rg</th>
                    <th>Assemblage &amp; mods</th>
                    <th className="text-right w-24">Puissance</th>
                    <th className="text-right w-16">Gain</th>
                    <th className="w-40"></th>
                  </tr>
                </thead>
                <tbody>
                  {powerRows.map((row, rank) => {
                    const { pb, mods } = row;
                    const modParts = mods
                      .map((n, i) =>
                        n > 0 ? `${n}×+10 ${statNames[i]}` : null
                      )
                      .filter(Boolean);
                    return (
                      <tr key={`${rank}-${pb.pieceIds.join(".")}`}>
                        <th>{rank + 1}</th>
                        <td>
                          <div className="flex items-center gap-1">
                            {pb.pieceIds.map((id) => {
                              const p = pieceById.get(id);
                              return p?.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={id}
                                  className={`w-7 h-7 rounded border border-base-300${
                                    p.isExotic ? " !border-[#ceae33]" : ""
                                  }`}
                                  src={`${BUNGIE_ROOT}${p.icon}`}
                                  alt={p.name}
                                  title={p.name}
                                />
                              ) : null;
                            })}
                          </div>
                          {modParts.length > 0 && (
                            <div className="text-xs text-primary mt-1">
                              🔧 {modParts.join(" · ")}
                            </div>
                          )}
                        </td>
                        <td className="text-right font-mono text-lg">
                          ✦ {pb.totalPower}
                        </td>
                        <td className="text-right font-mono">
                          {pb.totalPower > currentLight
                            ? `+${pb.totalPower - currentLight}`
                            : "—"}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-col gap-1 items-end">
                            <button
                              className="btn btn-xs btn-primary"
                              disabled={busy || !targetChar}
                              onClick={() => equipPowerBuild(row, true)}
                            >
                              Équiper + mods
                            </button>
                            <button
                              className="btn btn-xs btn-ghost"
                              disabled={busy || !targetChar}
                              onClick={() => equipPowerBuild(row, false)}
                            >
                              sans mods
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {powerBuilds && powerBuilds.length === 0 && !powerError && (
            <div role="alert" className="alert alert-info text-sm">
              <span>
                Tu es déjà à la Puissance maximale possible avec ton armure
                actuelle.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="collapse collapse-arrow bg-base-200 shadow">
        <input type="checkbox" />
        <div className="collapse-title font-medium text-primary">
          📖 Guide de l&apos;optimiseur — comment ça marche
        </div>
        <div className="collapse-content text-sm opacity-80 flex flex-col gap-2">
          <p>
            Le moteur teste les combinaisons casque × gants × torse × jambes ×
            objet de classe parmi <em>tes</em> pièces, puis classe les
            assemblages par un score : la somme de tes 6 stats, chacune
            multipliée par le poids choisi (Ign / ×1 / ×2 / ×3).
          </p>
          <p>
            <strong>Exotique verrouillé</strong> : imposé dans son emplacement,
            le reste en légendaire (une seule pièce exotique par assemblage).
            <strong> Minimum</strong> : tout assemblage sous ce seuil pour la
            stat est éliminé — les valeurs en rouge signalent un minimum non
            atteint.
          </p>
          <p>
            <strong>Stats de base</strong> (recommandé) : les mods actuellement
            posés sont retirés du calcul, tu compares le vrai potentiel des
            armures. <strong>Simulation des mods</strong> : un mod +10 par
            pièce, placés d&apos;abord pour tes minimums puis dans ta stat la
            plus pondérée — la ligne « mods » de chaque assemblage te dit quoi
            poser, et « Équiper + poser les mods » le fait pour toi.
          </p>
          <p>
            Les armes ne portent pas de stats d&apos;armure : ton arsenal
            complet est sur la page <a className="link link-primary" href="/armes">Armes</a>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* ── Panneau de réglages ── */}
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-4 p-5">
            <h2 className="card-title text-base">Réglages</h2>

            <div role="tablist" className="tabs tabs-boxed tabs-sm">
              {Object.entries(CLASS_NAMES).map(([value, label]) => (
                <a
                  key={value}
                  role="tab"
                  className={`tab${selectedClass === Number(value) ? " tab-active" : ""}`}
                  onClick={() => {
                    setSelectedClass(Number(value));
                    setExoticHash("none");
                    setBuilds(null);
                  }}
                >
                  {label}
                </a>
              ))}
            </div>

            <div className="form-control">
              <div className="label py-0">
                <span className="label-text text-sm">Exotique verrouillé</span>
              </div>
              <select
                className="select select-bordered select-sm w-full"
                value={exoticHash}
                onChange={(e) => setExoticHash(e.target.value)}
              >
                <option value="none">Aucun exotique</option>
                {exotics.map((x) => (
                  <option key={x.itemHash} value={x.itemHash}>
                    {x.name} — {ARMOR_BUCKETS[x.slot]}
                  </option>
                ))}
              </select>
            </div>

            {classChars.length > 0 && (
              <div className="form-control">
                <div className="label py-0">
                  <span className="label-text text-sm">Personnage cible</span>
                </div>
                <select
                  className="select select-bordered select-sm w-full"
                  value={targetChar}
                  onChange={(e) => setTargetChar(e.target.value)}
                >
                  {classChars.map((c) => (
                    <option key={c.characterId} value={c.characterId}>
                      {CLASS_NAMES[c.classType]} — ✦ {c.light}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="divider my-0" />

            {statNames.map((name, i) => (
              <div className="form-control" key={ARMOR_STAT_HASHES[i]}>
                <div className="label py-0">
                  <span className="label-text text-sm">{name}</span>
                  <span className="label-text-alt font-mono">
                    {minimums[i] > 0 ? `min ${minimums[i]}` : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="join">
                    {WEIGHT_OPTIONS.map((o) => (
                      <button
                        key={o.v}
                        className={`btn btn-xs join-item${
                          weights[i] === o.v ? " btn-primary" : ""
                        }`}
                        onClick={() => {
                          const next = [...weights];
                          next[i] = o.v;
                          setWeights(next);
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={10}
                    value={minimums[i]}
                    onChange={(e) => {
                      const next = [...minimums];
                      next[i] = Number(e.target.value);
                      setMinimums(next);
                    }}
                    className="range range-xs range-primary flex-1"
                  />
                </div>
              </div>
            ))}

            <div className="divider my-0" />

            <label className="label cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                checked={useBaseStats}
                onChange={(e) => setUseBaseStats(e.target.checked)}
                className="checkbox checkbox-primary checkbox-sm"
              />
              <span className="label-text text-sm">
                Stats de base (mods retirés)
              </span>
            </label>
            <label className="label cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                checked={simulateMods}
                onChange={(e) => setSimulateMods(e.target.checked)}
                className="checkbox checkbox-primary checkbox-sm"
              />
              <span className="label-text text-sm">
                Simuler 5 mods de stats (+10)
              </span>
            </label>

            <label className="label cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                checked={keepPower}
                onChange={(e) => setKeepPower(e.target.checked)}
                className="checkbox checkbox-primary checkbox-sm"
              />
              <span className="label-text text-sm">
                Ne jamais baisser ma puissance
                {powerContext.current > 0 && (
                  <span className="text-[#ffd970]"> (✦ {powerContext.current})</span>
                )}
              </span>
            </label>

            <button
              className="btn btn-primary btn-sm"
              onClick={run}
              disabled={computing || classPieces.length === 0}
            >
              {computing ? "Calcul…" : "Calculer les assemblages"}
            </button>
          </div>
        </div>

        {/* ── Résultats ── */}
        <div className="lg:col-span-3 min-w-0 flex flex-col gap-6">
          {log.length > 0 && (
            <div className="action-log">
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}

          {computing && (
            <div className="flex flex-col items-center gap-3 py-12 opacity-70">
              <span className="loading loading-spinner loading-lg text-primary" />
              <div className="text-sm">Énumération des combinaisons…</div>
            </div>
          )}

          {builds !== null && !computing && builds.length === 0 && (
            <div role="alert" className="alert alert-warning text-sm">
              <span>
                Aucun assemblage ne passe les contraintes.
                {keepPower && powerContext.current > 0 ? (
                  <>
                    {" "}
                    Le plancher de puissance (✦ {powerContext.current}) est
                    peut-être en cause : décoche « Ne jamais baisser ma
                    puissance », ou monte d&apos;abord tes pièces au niveau.
                  </>
                ) : (
                  " Assouplis les minimums, active la simulation de mods ou change d'exotique."
                )}
              </span>
            </div>
          )}

          {builds !== null && !computing && builds.length > 0 && (
            <>
              <div className="card bg-base-200 shadow">
                <div className="card-body">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="card-title">Assemblages retenus</h2>
                    <span className="badge badge-ghost">
                      {builds.length} résultats
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table table-zebra table-sm min-w-[820px]">
                      <thead>
                        <tr>
                          <th className="w-10">Rg</th>
                          <th>Assemblage</th>
                          {statNames.map((n, i) => (
                            <th
                              key={ARMOR_STAT_HASHES[i]}
                              className="text-right w-14"
                              title={n}
                            >
                              {n.slice(0, 3)}
                            </th>
                          ))}
                          <th className="text-right w-16">Total</th>
                          <th className="text-right w-16" title="Puissance d'équipement">
                            ✦
                          </th>
                          <th className="w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {builds.map((b, rank) => {
                          const total = b.totals.reduce((a, v) => a + v, 0);
                          const modParts = b.mods
                            .map((n, i) =>
                              n > 0 ? `${n}×+10 ${statNames[i]}` : null
                            )
                            .filter(Boolean);
                          return (
                            <tr
                              key={`${rank}-${b.pieceIds.join(".")}`}
                              className={`cursor-pointer transition-colors hover:bg-base-300 ${
                                rank === selBuild ? "!bg-primary/15" : ""
                              }`}
                              onClick={() => selectBuild(rank)}
                            >
                              <th
                                className={
                                  rank === selBuild ? "text-primary" : ""
                                }
                              >
                                {rank === selBuild ? "▸ " : ""}
                                {rank + 1}
                              </th>
                              <td>
                                <div className="flex items-center gap-1">
                                  {b.pieceIds.map((id) => {
                                    const p = pieceById.get(id);
                                    return p?.icon ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={id}
                                        className={`w-7 h-7 rounded border border-base-300${
                                          p.isExotic
                                            ? " !border-[#ceae33]"
                                            : ""
                                        }`}
                                        src={`${BUNGIE_ROOT}${p.icon}`}
                                        alt={p.name}
                                        title={p.name}
                                      />
                                    ) : null;
                                  })}
                                </div>
                                {modParts.length > 0 && (
                                  <div className="text-xs text-primary mt-1">
                                    {modParts.join(" · ")}
                                  </div>
                                )}
                              </td>
                              {b.totals.map((v, i) => (
                                <td
                                  key={ARMOR_STAT_HASHES[i]}
                                  className={`text-right font-mono${
                                    minimums[i] > 0 && v < minimums[i]
                                      ? " text-error"
                                      : ""
                                  }`}
                                >
                                  {v}
                                </td>
                              ))}
                              <td className="text-right font-mono text-lg">
                                {total}
                              </td>
                              <td
                                className={`text-right font-mono ${
                                  b.power >= powerContext.current
                                    ? "text-[#ffd970]"
                                    : "text-error"
                                }`}
                              >
                                {b.power}
                              </td>
                              <td className="text-right">
                                <button
                                  className={`btn btn-xs ${
                                    rank === selBuild
                                      ? "btn-primary"
                                      : "btn-outline btn-primary"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectBuild(rank);
                                  }}
                                >
                                  {rank === selBuild ? "Affiché" : "Voir"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {sel && (
                <div
                  ref={detailRef}
                  className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start scroll-mt-20"
                >
                  <div className="card bg-base-200 shadow xl:col-span-2 min-w-0">
                    <div className="card-body">
                      <h2 className="card-title text-base">
                        Détail — assemblage #{Math.min(selBuild, builds.length - 1) + 1}
                        <span className="badge badge-sm badge-primary badge-outline">
                          sélectionné dans le tableau
                        </span>
                      </h2>
                      <div className="overflow-x-auto">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>Emplacement</th>
                              <th>Pièce</th>
                              <th className="text-right">Total pièce</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sel.pieceIds.map((id) => {
                              const p = pieceById.get(id);
                              if (!p) return null;
                              const stats = useBaseStats
                                ? p.baseStats
                                : p.displayedStats;
                              const t = stats.reduce((a, v) => a + v, 0);
                              return (
                                <tr key={id}>
                                  <td className="opacity-60 text-xs uppercase">
                                    {ARMOR_BUCKETS[p.slot]}
                                  </td>
                                  <td>
                                    <div className="flex items-center gap-2">
                                      {p.icon ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          className={`w-8 h-8 rounded border border-base-300${
                                            p.isExotic
                                              ? " !border-[#ceae33]"
                                              : ""
                                          }`}
                                          src={`${BUNGIE_ROOT}${p.icon}`}
                                          alt=""
                                        />
                                      ) : null}
                                      <span>{p.name}</span>
                                      {p.isExotic && (
                                        <span className="badge badge-xs badge-primary">
                                          exotique
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="text-right font-mono">{t}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <label className="label cursor-pointer justify-end gap-2 py-0">
                        <span className="label-text text-xs opacity-70">
                          💾 Enregistrer en loadout après équipement
                        </span>
                        <input
                          type="checkbox"
                          checked={saveAsLoadout}
                          onChange={(e) => setSaveAsLoadout(e.target.checked)}
                          className="checkbox checkbox-primary checkbox-xs"
                        />
                      </label>
                      <div className="card-actions justify-end">
                        {simulateMods && sel.mods.some((n) => n > 0) && (
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={busy || !targetChar}
                            onClick={() => applyBuild(sel, true)}
                          >
                            Équiper + poser les mods
                          </button>
                        )}
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busy || !targetChar}
                          onClick={() => applyBuild(sel, false)}
                        >
                          Équiper cet assemblage
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card bg-base-200 shadow">
                    <div className="card-body gap-3">
                      <h2 className="card-title text-base">Stats finales</h2>
                      {sel.totals.map((v, i) => (
                        <div key={ARMOR_STAT_HASHES[i]}>
                          <div className="flex items-baseline justify-between text-xs">
                            <span>{statNames[i]}</span>
                            <span className="font-mono opacity-60">
                              {v}
                              {sel.mods[i] > 0
                                ? ` (dont +${sel.mods[i] * 10} mods)`
                                : ""}
                            </span>
                          </div>
                          <progress
                            className={`progress h-1.5 mt-1 ${
                              minimums[i] > 0 && v < minimums[i]
                                ? "progress-error"
                                : "progress-primary"
                            }`}
                            value={v}
                            max={STAT_CAP}
                          />
                        </div>
                      ))}
                      <p className="text-xs opacity-50">
                        Mode :{" "}
                        {useBaseStats ? "stats de base" : "stats affichées"}
                        {simulateMods ? " · mods simulés" : ""}. Bonus de set et
                        mods d&apos;accord non simulés.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
