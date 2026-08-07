"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_BUCKETS,
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_ARMOR,
  STAT_CAP,
  TIER_EXOTIC,
} from "@/lib/destiny-constants";
import {
  computeBestBuilds,
  type Build,
  type EnginePiece,
} from "@/lib/optimizer-engine";
import {
  buildLocationMap,
  equipItems,
  findStatModSocket,
  insertPlug,
  moveToCharacter,
  sleep,
} from "@/lib/d2-actions";
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
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [selBuild, setSelBuild] = useState(0);
  const [computing, setComputing] = useState(false);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [targetChar, setTargetChar] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

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

  useEffect(() => {
    if (classChars.length > 0) setTargetChar(classChars[0].characterId);
    else setTargetChar("");
  }, [classChars]);

  function pushLog(m: string) {
    setLog((prev) => [...prev.slice(-40), m]);
  }

  async function applyBuild(b: Build, withMods: boolean) {
    if (!defs || !targetChar || busy) return;
    setBusy(true);
    setLog([]);
    pushLog("▶️ Application de l'assemblage…");
    try {
      const res = await fetch("/api/bungie/profile?scope=gear");
      if (!res.ok) throw new Error("profil illisible");
      const fresh = (await res.json()) as ProfileResponse;
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
        const flat: number[] = [];
        b.mods.forEach((n, i) => {
          for (let k = 0; k < n; k++) flat.push(ARMOR_STAT_HASHES[i]);
        });
        for (const id of b.pieceIds) {
          if (flat.length === 0) break;
          const piece = pieceById.get(id);
          if (!piece) continue;
          const socket = findStatModSocket(defs, piece.itemHash);
          const statHash = flat[0];
          const plugHash = socket?.byStat.get(statHash);
          if (!socket || !plugHash) {
            pushLog(
              `⚠️ ${piece.name} : emplacement de mod de stats introuvable.`
            );
            continue;
          }
          flat.shift();
          const statName =
            defs.stats[statHash]?.displayProperties?.name ?? "stat";
          try {
            await insertPlug({
              itemId: id,
              characterId: targetChar,
              socketIndex: socket.socketIndex,
              plugItemHash: plugHash,
            });
            pushLog(`🔧 +10 ${statName} posé sur ${piece.name}.`);
            await sleep(200);
          } catch (e) {
            pushLog(
              `⚠️ ${piece.name} : mod refusé (${e instanceof Error ? e.message : "énergie insuffisante ?"})`
            );
          }
        }
      }
      pushLog("✅ Terminé.");
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
      });
      setBuilds(result);
      setComputing(false);
    }, 30);
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
        <h1 className="text-2xl font-semibold">Optimiseur d&apos;armure</h1>
        <span className="badge badge-ghost">
          {classPieces.length} pièces analysées
        </span>
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
                Aucun assemblage ne respecte ces minimums avec ton arsenal.
                Assouplis les contraintes, active la simulation de mods ou
                change d&apos;exotique.
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
                              key={b.pieceIds.join(".")}
                              className={`cursor-pointer${
                                rank === selBuild ? " bg-base-300" : ""
                              }`}
                              onClick={() => setSelBuild(rank)}
                            >
                              <th>{rank + 1}</th>
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
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {sel && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                  <div className="card bg-base-200 shadow xl:col-span-2 min-w-0">
                    <div className="card-body">
                      <h2 className="card-title text-base">
                        Détail — assemblage #{Math.min(selBuild, builds.length - 1) + 1}
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
    </div>
  );
}
