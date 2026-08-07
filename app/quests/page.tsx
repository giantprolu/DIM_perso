"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  BUCKET_PURSUITS,
  BUNGIE_ROOT,
  CLASS_NAMES,
  ITEM_TYPE_BOUNTY,
  ITEM_TYPE_QUEST,
  ITEM_TYPE_QUEST_STEP,
  RECORD_STATE_OBJECTIVE_NOT_COMPLETED,
  RECORD_STATE_REDEEMED,
} from "@/lib/destiny-constants";
import type {
  Character,
  Defs,
  ObjectiveProgress,
  ProfileResponse,
  RecordComponent,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Section = "pursuits" | "seasonal" | "ranks";
type PursuitTab = "all" | "quests" | "bounties";

interface PursuitVM {
  key: string;
  name: string;
  typeName: string;
  description: string;
  icon?: string;
  isBounty: boolean;
  isQuest: boolean;
  expirationDate?: string;
  objectives: ObjectiveProgress[];
  complete: boolean;
}

interface RecordVM {
  hash: number;
  name: string;
  description: string;
  icon?: string;
  objectives: ObjectiveProgress[];
  complete: boolean;
  redeemed: boolean;
}

interface RecordGroup {
  name: string;
  records: RecordVM[];
}

function expiryInfo(iso?: string): { label: string; cls: string } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "Expirée", cls: "badge-error" };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const label =
    h >= 48
      ? `${Math.floor(h / 24)} j ${h % 24} h`
      : h >= 1
        ? `${h} h ${m.toString().padStart(2, "0")}`
        : `${m} min`;
  const cls = h < 24 ? "badge-error" : h < 72 ? "badge-warning" : "badge-ghost";
  return { label, cls };
}

function objectivePct(o: ObjectiveProgress, defs: Defs | null): number {
  const cv =
    o.completionValue || defs?.objectives[o.objectiveHash]?.completionValue || 0;
  const progress = o.progress ?? (o.complete ? cv : 0);
  return cv > 0 ? Math.min(1, progress / cv) : o.complete ? 1 : 0;
}

function overallPct(objectives: ObjectiveProgress[], defs: Defs | null): number {
  if (objectives.length === 0) return 0;
  const sum = objectives.reduce((a, o) => a + objectivePct(o, defs), 0);
  return Math.round((sum / objectives.length) * 100);
}

/** Récupère récursivement les hashs d'archives d'un nœud de présentation. */
function collectRecordHashes(
  nodeHash: number | undefined,
  defs: Defs,
  depth = 3
): number[] {
  if (!nodeHash || depth < 0) return [];
  const node = defs.nodes[nodeHash];
  if (!node) return [];
  const out: number[] = [];
  for (const r of node.children?.records ?? []) out.push(r.recordHash);
  for (const child of node.children?.presentationNodes ?? []) {
    out.push(...collectRecordHashes(child.presentationNodeHash, defs, depth - 1));
  }
  return out;
}

function ObjectiveBar({
  objective,
  defs,
}: {
  objective: ObjectiveProgress;
  defs: Defs | null;
}) {
  const objDef = defs?.objectives[objective.objectiveHash];
  const cv = objective.completionValue || objDef?.completionValue || 0;
  const progress = objective.progress ?? (objective.complete ? cv : 0);
  const pct = objectivePct(objective, defs) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs opacity-80">
        <span className="truncate">
          {objDef?.progressDescription || "Progression"}
        </span>
        <span
          className={
            objective.complete ? "text-success" : "font-mono opacity-70"
          }
        >
          {objective.complete ? "✓" : cv > 1 ? `${progress} / ${cv}` : ""}
        </span>
      </div>
      <progress
        className={`progress h-1 mt-1 ${
          objective.complete ? "progress-success" : "progress-primary"
        }`}
        value={pct}
        max={100}
      />
    </div>
  );
}

export default function QuestsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState<string>("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState<string>("");
  const [section, setSection] = useState<Section>("pursuits");
  const [pursuitTab, setPursuitTab] = useState<PursuitTab>("all");
  const [filter, setFilter] = useState("");
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Récupération de tes personnages…");
        const res = await fetch("/api/bungie/profile?scope=quests");
        if (res.status === 401) {
          setPhase("unauth");
          return;
        }
        const data = (await res.json()) as ProfileResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur profil");
        if (cancelled) return;
        setProfile(data);
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

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  // ---------- Poursuites ----------
  const pursuits: PursuitVM[] = useMemo(() => {
    if (!defs || !profile || !selectedChar) return [];
    const items =
      profile.characterInventories?.data?.[selectedChar]?.items ?? [];
    const instanced = profile.itemComponents?.objectives?.data ?? {};
    const uninstanced =
      profile.characterUninstancedItemComponents?.[selectedChar]?.objectives
        ?.data ?? {};

    const list: PursuitVM[] = [];
    for (const item of items) {
      if (item.bucketHash !== BUCKET_PURSUITS) continue;
      const def = defs.items[item.itemHash];
      const objectives: ObjectiveProgress[] =
        (item.itemInstanceId && instanced[item.itemInstanceId]?.objectives) ||
        uninstanced[item.itemHash]?.objectives ||
        [];
      const visible = objectives.filter((o) => o.visible !== false);
      const complete = visible.length > 0 && visible.every((o) => o.complete);

      list.push({
        key: item.itemInstanceId ?? `${item.itemHash}`,
        name: def?.redacted
          ? "Classifié"
          : def?.displayProperties?.name || `Objet ${item.itemHash}`,
        typeName: def?.itemTypeDisplayName ?? "",
        description: def?.displayProperties?.description ?? "",
        icon: def?.displayProperties?.icon,
        isBounty: def?.itemType === ITEM_TYPE_BOUNTY,
        isQuest:
          def?.itemType === ITEM_TYPE_QUEST ||
          def?.itemType === ITEM_TYPE_QUEST_STEP ||
          Boolean(def?.setData),
        expirationDate: item.expirationDate,
        objectives: visible,
        complete,
      });
    }

    list.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return a.name.localeCompare(b.name, "fr");
    });
    return list;
  }, [defs, profile, selectedChar]);

  const shownPursuits = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return pursuits.filter((p) => {
      if (pursuitTab === "quests" && !p.isQuest) return false;
      if (pursuitTab === "bounties" && !p.isBounty) return false;
      if (hideCompleted && p.complete) return false;
      if (!f) return true;
      return (
        p.name.toLowerCase().includes(f) ||
        p.typeName.toLowerCase().includes(f) ||
        p.description.toLowerCase().includes(f)
      );
    });
  }, [pursuits, pursuitTab, filter, hideCompleted]);

  // ---------- Archives (défis saisonniers, rangs) ----------
  function getRecordComponent(hash: number): RecordComponent | undefined {
    return (
      profile?.profileRecords?.data?.records?.[hash] ??
      profile?.characterRecords?.data?.[selectedChar]?.records?.[hash]
    );
  }

  function buildRecordVM(hash: number): RecordVM | null {
    if (!defs) return null;
    const def = defs.records[hash];
    if (!def || def.redacted) return null;
    const name = def.displayProperties?.name;
    if (!name) return null;
    const comp = getRecordComponent(hash);
    const objectives = (
      comp?.objectives?.length ? comp.objectives : comp?.intervalObjectives ?? []
    ).filter((o) => o.visible !== false);
    const complete = comp
      ? (comp.state & RECORD_STATE_OBJECTIVE_NOT_COMPLETED) === 0
      : false;
    return {
      hash,
      name,
      description: def.displayProperties?.description ?? "",
      icon: def.displayProperties?.icon,
      objectives,
      complete,
      redeemed: comp ? (comp.state & RECORD_STATE_REDEEMED) !== 0 : false,
    };
  }

  const seasonalGroups: RecordGroup[] = useMemo(() => {
    if (!defs || !profile) return [];
    const seasonHash = profile.profile?.data?.currentSeasonHash;
    if (!seasonHash) return [];
    const rootHash =
      defs.seasons[seasonHash]?.seasonalChallengesPresentationNodeHash;
    if (!rootHash) return [];
    const root = defs.nodes[rootHash];
    if (!root) return [];

    const groups: RecordGroup[] = [];
    const directRecords = (root.children?.records ?? [])
      .map((r) => buildRecordVM(r.recordHash))
      .filter((r): r is RecordVM => r !== null);
    if (directRecords.length > 0) {
      groups.push({ name: "Défis", records: directRecords });
    }
    for (const child of root.children?.presentationNodes ?? []) {
      const node = defs.nodes[child.presentationNodeHash];
      if (!node) continue;
      const records = collectRecordHashes(child.presentationNodeHash, defs)
        .map((h) => buildRecordVM(h))
        .filter((r): r is RecordVM => r !== null);
      if (records.length > 0) {
        groups.push({
          name: node.displayProperties?.name || "Défis",
          records,
        });
      }
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, profile, selectedChar]);

  const ranks = useMemo(() => {
    if (!defs) return [];
    return Object.values(defs.guardianRanks)
      .filter((r) => r.presentationNodeHash)
      .sort((a, b) => a.rankNumber - b.rankNumber);
  }, [defs]);

  const currentRank = profile?.profile?.data?.currentGuardianRank ?? 0;

  useEffect(() => {
    if (selectedRank === null && ranks.length > 0) {
      const next =
        ranks.find((r) => r.rankNumber === currentRank + 1) ??
        ranks.find((r) => r.rankNumber === currentRank) ??
        ranks[0];
      setSelectedRank(next.rankNumber);
    }
  }, [ranks, currentRank, selectedRank]);

  const rankRecords: RecordVM[] = useMemo(() => {
    if (!defs || selectedRank === null) return [];
    const rank = ranks.find((r) => r.rankNumber === selectedRank);
    if (!rank) return [];
    return collectRecordHashes(rank.presentationNodeHash, defs)
      .map((h) => buildRecordVM(h))
      .filter((r): r is RecordVM => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, ranks, selectedRank, profile, selectedChar]);

  function filterRecords(records: RecordVM[]): RecordVM[] {
    const f = filter.trim().toLowerCase();
    return records.filter((r) => {
      if (hideCompleted && r.complete) return false;
      if (!f) return true;
      return (
        r.name.toLowerCase().includes(f) ||
        r.description.toLowerCase().includes(f)
      );
    });
  }

  function QuestCard({
    icon,
    title,
    badge,
    typeLine,
    description,
    objectives,
    complete,
  }: {
    icon?: string;
    title: string;
    badge?: { label: string; cls: string } | null;
    typeLine?: string;
    description?: string;
    objectives: ObjectiveProgress[];
    complete: boolean;
  }) {
    const pct = complete ? 100 : overallPct(objectives, defs);
    return (
      <div
        className={`card card-side bg-base-200 shadow${complete ? " opacity-60" : ""}`}
      >
        <div className="card-body p-4">
          <div className="flex items-start gap-4">
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="item-icon" src={`${BUNGIE_ROOT}${icon}`} alt="" />
            ) : (
              <div className="item-icon" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="card-title text-base gap-2 flex-wrap">
                <span className="truncate">{title}</span>
                {complete && (
                  <span className="badge badge-sm badge-success">terminé</span>
                )}
                {badge && !complete && (
                  <span className={`badge badge-sm ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}
              </h2>
              {typeLine && (
                <div className="text-xs opacity-50 mt-0.5">{typeLine}</div>
              )}
              {description && (
                <p className="text-sm opacity-70 mt-1 line-clamp-2">
                  {description}
                </p>
              )}
              <div className="flex flex-col gap-2 mt-3">
                {objectives.map((o) => (
                  <ObjectiveBar key={o.objectiveHash} objective={o} defs={defs} />
                ))}
              </div>
            </div>
            {objectives.length > 0 && (
              <div
                className={`radial-progress flex-none text-xs font-mono ${
                  complete ? "text-success" : "text-primary"
                }`}
                style={
                  {
                    "--value": pct,
                    "--size": "3.5rem",
                    "--thickness": "3px",
                  } as React.CSSProperties
                }
                role="progressbar"
              >
                {pct}%
              </div>
            )}
          </div>
        </div>
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
        <p className="opacity-70">Connecte-toi pour voir tes quêtes.</p>
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

  const sectionCounts =
    section === "pursuits"
      ? {
          total: pursuits.length,
          done: pursuits.filter((p) => p.complete).length,
        }
      : section === "seasonal"
        ? {
            total: seasonalGroups.reduce((a, g) => a + g.records.length, 0),
            done: seasonalGroups.reduce(
              (a, g) => a + g.records.filter((r) => r.complete).length,
              0
            ),
          }
        : {
            total: rankRecords.length,
            done: rankRecords.filter((r) => r.complete).length,
          };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Quêtes &amp; progression</h1>
        <span className="badge badge-ghost">
          {sectionCounts.done}/{sectionCounts.total} terminés
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* ── Panneau latéral ── */}
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-4 p-5">
            <h2 className="card-title text-base">Affichage</h2>
            <div role="tablist" className="tabs tabs-boxed tabs-sm">
              {(
                [
                  ["pursuits", "Poursuites"],
                  ["seasonal", "Défis"],
                  ["ranks", "Rangs"],
                ] as [Section, string][]
              ).map(([value, label]) => (
                <a
                  key={value}
                  role="tab"
                  className={`tab${section === value ? " tab-active" : ""}`}
                  onClick={() => setSection(value)}
                >
                  {label}
                </a>
              ))}
            </div>

            {section === "pursuits" && (
              <div className="join">
                {(
                  [
                    ["all", "Tout"],
                    ["quests", "Quêtes"],
                    ["bounties", "Primes"],
                  ] as [PursuitTab, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`btn btn-xs join-item${
                      pursuitTab === value ? " btn-primary" : ""
                    }`}
                    onClick={() => setPursuitTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {section === "ranks" && (
              <select
                className="select select-bordered select-sm w-full"
                value={selectedRank ?? ""}
                onChange={(e) => setSelectedRank(Number(e.target.value))}
              >
                {ranks.map((r) => (
                  <option key={r.hash} value={r.rankNumber}>
                    Rang {r.rankNumber} — {r.displayProperties?.name}
                    {r.rankNumber === currentRank ? " (actuel)" : ""}
                  </option>
                ))}
              </select>
            )}

            <div className="divider my-0" />

            <label className="label cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
                className="toggle toggle-primary toggle-sm"
              />
              <span className="label-text text-sm">Masquer les terminés</span>
            </label>

            <input
              className="input input-bordered input-sm w-full"
              placeholder="Filtrer par nom…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />

            <div className="stats stats-vertical shadow bg-base-300">
              <div className="stat py-2">
                <div className="stat-title text-xs">Terminés</div>
                <div className="stat-value text-2xl text-success">
                  {sectionCounts.done}
                </div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">
                  {section === "ranks" ? "Rang actuel" : "Total"}
                </div>
                <div className="stat-value text-2xl">
                  {section === "ranks" ? currentRank : sectionCounts.total}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Contenu ── */}
        <div className="lg:col-span-3 min-w-0 flex flex-col gap-4">
          {section === "pursuits" &&
            (shownPursuits.length === 0 ? (
              <div className="opacity-60 py-8 text-center">
                Aucune poursuite ne correspond.
              </div>
            ) : (
              shownPursuits.map((p) => (
                <QuestCard
                  key={p.key}
                  icon={p.icon}
                  title={p.name}
                  badge={p.complete ? null : expiryInfo(p.expirationDate)}
                  typeLine={p.typeName}
                  description={p.description}
                  objectives={p.objectives}
                  complete={p.complete}
                />
              ))
            ))}

          {section === "seasonal" &&
            (seasonalGroups.length === 0 ? (
              <div className="opacity-60 py-8 text-center">
                Impossible de trouver les défis de la saison en cours dans le
                manifest.
              </div>
            ) : (
              seasonalGroups.map((g) => {
                const records = filterRecords(g.records);
                if (records.length === 0) return null;
                const done = g.records.filter((r) => r.complete).length;
                return (
                  <div key={g.name} className="flex flex-col gap-3">
                    <div className="divider divider-start text-sm uppercase tracking-wider opacity-70">
                      <span className="whitespace-nowrap">
                        {g.name} · {done}/{g.records.length}
                      </span>
                    </div>
                    {records.map((r) => (
                      <QuestCard
                        key={r.hash}
                        icon={r.icon}
                        title={r.name}
                        description={r.description}
                        objectives={r.objectives}
                        complete={r.complete}
                      />
                    ))}
                  </div>
                );
              })
            ))}

          {section === "ranks" &&
            (rankRecords.length === 0 ? (
              <div className="opacity-60 py-8 text-center">
                Aucun objectif trouvé pour ce rang.
              </div>
            ) : (
              filterRecords(rankRecords).map((r) => (
                <QuestCard
                  key={r.hash}
                  icon={r.icon}
                  title={r.name}
                  description={r.description}
                  objectives={r.objectives}
                  complete={r.complete}
                />
              ))
            ))}
        </div>
      </div>
    </div>
  );
}
