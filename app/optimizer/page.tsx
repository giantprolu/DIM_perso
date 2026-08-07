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
import {
  computeBestBuilds,
  type Build,
  type EnginePiece,
} from "@/lib/optimizer-engine";
import type {
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
  /** Stats affichées en jeu (mods actuels compris) */
  displayedStats: number[];
  /** Stats de base (mods actuels retirés) */
  baseStats: number[];
}

const WEIGHT_OPTIONS = [
  { v: 0, label: "Ignorer" },
  { v: 1, label: "Faible" },
  { v: 2, label: "Moyen" },
  { v: 3, label: "Fort" },
];

/**
 * Stats de base ≈ stats affichées − contribution des mods amovibles
 * (plugs dont la catégorie commence par "enhancements.").
 * Le masterwork et l'intrinsèque de la pièce restent inclus.
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
            stats: baseStats, // remplacé au calcul selon le mode
            displayedStats,
            baseStats,
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

      <details className="guide card">
        <summary>📖 Guide de l&apos;optimiseur — comment ça marche</summary>
        <div className="guide-body">
          <h4>Le principe</h4>
          <p>
            Le moteur teste les combinaisons casque × gants × torse × jambes ×
            objet de classe parmi <em>tes</em> pièces, puis classe les builds
            par un score : la somme de tes 6 stats, chacune multipliée par le
            poids que tu lui donnes.
          </p>
          <h4>Classe</h4>
          <p>
            Seules les armures de la classe choisie sont prises en compte. Par
            défaut : ton dernier personnage joué.
          </p>
          <h4>Exotique verrouillé</h4>
          <p>
            Choisis l&apos;exotique autour duquel tu construis : il sera imposé
            dans son emplacement, et les autres emplacements ne contiendront
            que du légendaire (une seule pièce exotique par build, comme en
            jeu). « Aucun exotique » = build 100&nbsp;% légendaire.
          </p>
          <h4>Priorités (poids)</h4>
          <p>
            <strong>Ignorer</strong> = la stat ne compte pas dans le score.
            <strong> Faible / Moyen / Fort</strong> = ×1 / ×2 / ×3. Exemple
            build grenade : Grenade sur Fort, Super sur Moyen, le reste sur
            Faible ou Ignorer.
          </p>
          <h4>Minimum</h4>
          <p>
            Seuil obligatoire : tout build sous ce total pour la stat est
            éliminé. Utile pour garantir par exemple 100 en Santé quoi
            qu&apos;il arrive. Les cases en rouge dans les résultats signalent
            un minimum non atteint.
          </p>
          <h4>Stats de base vs affichées</h4>
          <p>
            <strong>Stats de base</strong> (recommandé) : le moteur retire la
            contribution des mods actuellement posés sur tes pièces — tu
            compares le vrai potentiel des armures, puisque les mods se
            déplacent librement. <strong>Stats affichées</strong> : telles
            quelles en jeu, mods compris.
          </p>
          <h4>Simulation des mods de stats</h4>
          <p>
            Le moteur suppose un mod de stat (+10) par pièce, soit 5 mods : il
            les place d&apos;abord pour atteindre tes minimums, puis met le
            reste dans ta stat la plus pondérée. La ligne « Mods suggérés »
            de chaque build te dit quoi poser.
          </p>
          <h4>Et les armes ?</h4>
          <p>
            Les armes ne portent pas de stats d&apos;armure : elles
            n&apos;entrent pas dans ce calcul. Ton arsenal complet (perks et
            mods compris) est sur la page <a href="/armes">Armes</a>.
          </p>
        </div>
      </details>

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
          <div className="toggle-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={useBaseStats}
                onChange={(e) => setUseBaseStats(e.target.checked)}
              />
              Utiliser les stats de base (mods actuels retirés)
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={simulateMods}
                onChange={(e) => setSimulateMods(e.target.checked)}
              />
              Simuler 5 mods de stats (+10)
            </label>
          </div>
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
              Assouplis les contraintes, active la simulation de mods ou change
              d&apos;exotique.
            </div>
          ) : (
            builds.map((b, rank) => {
              const total = b.totals.reduce((a, v) => a + v, 0);
              const modParts = b.mods
                .map((n, i) => (n > 0 ? `${n} × +10 ${statNames[i]}` : null))
                .filter(Boolean);
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
                  {modParts.length > 0 && (
                    <p className="mods-line">
                      Mods suggérés : {modParts.join(" · ")}
                    </p>
                  )}
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
            Mode :{" "}
            {useBaseStats
              ? "stats de base (mods actuels retirés)"
              : "stats affichées (mods actuels compris)"}
            {simulateMods ? " · simulation de 5 mods de stats (+10) activée" : ""}
            . Les bonus de set et mods d&apos;accord ne sont pas encore
            simulés.
          </p>
        </div>
      )}
    </div>
  );
}
