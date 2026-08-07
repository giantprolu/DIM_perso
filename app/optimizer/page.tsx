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
  TIER_EXOTIC,
} from "@/lib/destiny-constants";
import { computeBestBuilds, type Build, type EnginePiece } from "@/lib/optimizer-engine";
import type { Defs, ProfileItem, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

interface ArmorPiece extends EnginePiece {
  name: string;
  icon?: string;
  classType: number;
}

const WEIGHT_OPTIONS = [
  { v: 0, label: "Ignorer" },
  { v: 1, label: "Faible" },
  { v: 2, label: "Moyen" },
  { v: 3, label: "Fort" },
];

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
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [computing, setComputing] = useState(false);

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

        // Rassembler tous les items : coffre + inventaires + équipé
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
        const pool: ArmorPiece[] = [];

        for (const item of allItems) {
          if (!item.itemInstanceId) continue;
          const def = d.items[item.itemHash];
          if (!def || def.itemType !== ITEM_TYPE_ARMOR) continue;
          const slot = def.inventory?.bucketTypeHash ?? 0;
          if (!(slot in ARMOR_BUCKETS)) continue;

          const instStats = statsData[item.itemInstanceId]?.stats;
          const stats = ARMOR_STAT_HASHES.map(
            (h) => instStats?.[h]?.value ?? 0
          );

          pool.push({
            id: item.itemInstanceId,
            itemHash: item.itemHash,
            slot,
            isExotic: def.inventory?.tierType === TIER_EXOTIC,
            stats,
            name: def.displayProperties?.name || `Objet ${item.itemHash}`,
            icon: def.displayProperties?.icon,
            classType: def.classType,
          });
        }

        setPieces(pool);

        // Classe par défaut : personnage joué le plus récemment
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
    // Laisse le temps au spinner de s'afficher avant le calcul synchrone
    setTimeout(() => {
      const result = computeBestBuilds({
        pieces: classPieces,
        weights,
        minimums,
        exoticHash: exoticHash === "none" ? null : Number(exoticHash),
      });
      setBuilds(result);
      setComputing(false);
    }, 30);
  }

  if (phase === "loading") {
    return (
      <div className="status">
        <div className="spinner" />
        <div>{statusMsg}</div>
      </div>
    );
  }

  if (phase === "unauth") {
    return (
      <div className="status">
        <p>Connecte-toi pour utiliser l&apos;optimiseur.</p>
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      </div>
    );
  }

  if (phase === "error") {
    return <div className="error-box">{error}</div>;
  }

  return (
    <div>
      <h1>Optimiseur d&apos;armure</h1>
      <p style={{ color: "var(--text-dim)" }}>
        {classPieces.length} pièces d&apos;armure analysées pour cette classe
        (coffre + personnages + équipé).
      </p>

      <div className="opt-controls">
        <div className="tabs">
          {Object.entries(CLASS_NAMES).map(([value, label]) => (
            <button
              key={value}
              className={`tab${selectedClass === Number(value) ? " active" : ""}`}
              onClick={() => {
                setSelectedClass(Number(value));
                setExoticHash("none");
                setBuilds(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="field card">
          <label htmlFor="exotic">Exotique verrouillé</label>
          <select
            id="exotic"
            value={exoticHash}
            onChange={(e) => setExoticHash(e.target.value)}
          >
            <option value="none">Aucun exotique (build légendaire)</option>
            {exotics.map((x) => (
              <option key={x.itemHash} value={x.itemHash}>
                {x.name} — {ARMOR_BUCKETS[x.slot]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px" }}>Priorités de stats</h3>
          <div className="stat-grid">
            {statNames.map((name, i) => (
              <div className="stat-control" key={ARMOR_STAT_HASHES[i]}>
                <label>{name}</label>
                <select
                  value={weights[i]}
                  onChange={(e) => {
                    const next = [...weights];
                    next[i] = Number(e.target.value);
                    setWeights(next);
                  }}
                >
                  {WEIGHT_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <label style={{ marginTop: 8 }}>Minimum</label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={5}
                  value={minimums[i]}
                  onChange={(e) => {
                    const next = [...minimums];
                    next[i] = Math.max(0, Number(e.target.value) || 0);
                    setMinimums(next);
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <button
            className="btn btn-primary"
            onClick={run}
            disabled={computing || classPieces.length === 0}
          >
            {computing ? "Calcul en cours…" : "Calculer les meilleurs builds"}
          </button>
        </div>
      </div>

      {computing && (
        <div className="status">
          <div className="spinner" />
          <div>Énumération des combinaisons…</div>
        </div>
      )}

      {builds !== null && !computing && (
        <div>
          {builds.length === 0 ? (
            <div className="error-box">
              Aucun build ne respecte ces minimums avec ton arsenal actuel.
              Assouplis les contraintes ou change d&apos;exotique.
            </div>
          ) : (
            builds.map((b, rank) => {
              const total = b.totals.reduce((a, v) => a + v, 0);
              return (
                <div className="build-card" key={b.pieceIds.join(".")}>
                  <div className="build-header">
                    <span className="build-rank">Build #{rank + 1}</span>
                    <span className="build-total">
                      Total : {total} · Score pondéré : {b.score}
                    </span>
                  </div>
                  <div className="build-stats">
                    {b.totals.map((v, i) => (
                      <div
                        className={`build-stat${
                          minimums[i] > 0 && v < minimums[i] ? " under" : ""
                        }`}
                        key={ARMOR_STAT_HASHES[i]}
                      >
                        <div className="v">{v}</div>
                        <div className="n">{statNames[i]}</div>
                      </div>
                    ))}
                  </div>
                  <div className="build-pieces">
                    {b.pieceIds.map((id) => {
                      const p = pieceById.get(id);
                      if (!p) return null;
                      return (
                        <div
                          className={`piece${p.isExotic ? " exotic" : ""}`}
                          key={id}
                        >
                          {p.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`${BUNGIE_ROOT}${p.icon}`} alt="" />
                          ) : null}
                          <div>
                            <div>{p.name}</div>
                            <div className="piece-slot">
                              {ARMOR_BUCKETS[p.slot]}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          <p className="note">
            Les stats utilisées sont celles affichées en jeu, mods actuellement
            équipés compris (le calcul sur stats de base viendra en v2).
          </p>
        </div>
      )}
    </div>
  );
}
