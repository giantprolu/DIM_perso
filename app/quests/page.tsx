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

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expirée";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `Expire dans ${Math.floor(h / 24)} j`;
  if (h >= 1) return `Expire dans ${h} h ${m.toString().padStart(2, "0")}`;
  return `Expire dans ${m} min`;
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
  const pct =
    cv > 0 ? Math.min(100, (progress / cv) * 100) : objective.complete ? 100 : 0;
  return (
    <div className="objective">
      <div className="objective-label">
        <span>{objDef?.progressDescription || "Progression"}</span>
        <span className={objective.complete ? "done" : ""}>
          {objective.complete ? "✓" : cv > 1 ? `${progress} / ${cv}` : ""}
        </span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill${objective.complete ? " done" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
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
      if (!f) return true;
      return (
        p.name.toLowerCase().includes(f) ||
        p.typeName.toLowerCase().includes(f) ||
        p.description.toLowerCase().includes(f)
      );
    });
  }, [pursuits, pursuitTab, filter]);

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

  function RecordCard({ record }: { record: RecordVM }) {
    return (
      <div className={`item-card${record.complete ? " record-done" : ""}`}>
        {record.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="item-icon" src={`${BUNGIE_ROOT}${record.icon}`} alt="" />
        ) : (
          <div className="item-icon" />
        )}
        <div className="item-body">
          <p className="item-name">
            {record.name}
            {record.complete && <span className="done-badge"> ✓</span>}
          </p>
          {record.description && (
            <p className="item-desc">{record.description}</p>
          )}
          {record.objectives.map((o) => (
            <ObjectiveBar key={o.objectiveHash} objective={o} defs={defs} />
          ))}
        </div>
      </div>
    );
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
        <p>Connecte-toi pour voir tes quêtes.</p>
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
      <h1>Quêtes &amp; progression</h1>

      <div className="char-row">
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

      <div className="tabs">
        {(
          [
            ["pursuits", "Poursuites"],
            ["seasonal", "Défis saisonniers"],
            ["ranks", "Rangs de Gardien"],
          ] as [Section, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={`tab${section === value ? " active" : ""}`}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="tabs">
        {section === "pursuits" &&
          (
            [
              ["all", "Tout"],
              ["quests", "Quêtes"],
              ["bounties", "Primes"],
            ] as [PursuitTab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={`tab${pursuitTab === value ? " active" : ""}`}
              onClick={() => setPursuitTab(value)}
            >
              {label}
            </button>
          ))}
        {section === "ranks" && (
          <select
            className="filter-select"
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
        {section !== "pursuits" && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(e) => setHideCompleted(e.target.checked)}
            />
            Masquer les terminés
          </label>
        )}
        <input
          className="search-input"
          placeholder="Filtrer par nom…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {section === "pursuits" &&
        (shownPursuits.length === 0 ? (
          <div className="status">Aucune poursuite ne correspond.</div>
        ) : (
          <div className="grid grid-2">
            {shownPursuits.map((p) => (
              <div className="item-card" key={p.key}>
                {p.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="item-icon"
                    src={`${BUNGIE_ROOT}${p.icon}`}
                    alt=""
                  />
                ) : (
                  <div className="item-icon" />
                )}
                <div className="item-body">
                  <p className="item-name">{p.name}</p>
                  <div className="item-type">
                    {p.typeName}
                    {p.expirationDate && !p.complete && (
                      <>
                        {" · "}
                        <span className="expiry">
                          {formatExpiry(p.expirationDate)}
                        </span>
                      </>
                    )}
                  </div>
                  {p.description && (
                    <p className="item-desc">{p.description}</p>
                  )}
                  {p.objectives.map((o) => (
                    <ObjectiveBar
                      key={o.objectiveHash}
                      objective={o}
                      defs={defs}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

      {section === "seasonal" &&
        (seasonalGroups.length === 0 ? (
          <div className="status">
            Impossible de trouver les défis de la saison en cours dans le
            manifest.
          </div>
        ) : (
          seasonalGroups.map((g) => {
            const records = filterRecords(g.records);
            if (records.length === 0) return null;
            const done = g.records.filter((r) => r.complete).length;
            return (
              <div key={g.name} className="record-group">
                <h3>
                  {g.name}{" "}
                  <span className="group-count">
                    {done}/{g.records.length}
                  </span>
                </h3>
                <div className="grid grid-2">
                  {records.map((r) => (
                    <RecordCard key={r.hash} record={r} />
                  ))}
                </div>
              </div>
            );
          })
        ))}

      {section === "ranks" &&
        (rankRecords.length === 0 ? (
          <div className="status">
            Aucun objectif trouvé pour ce rang (ou données de rang
            indisponibles).
          </div>
        ) : (
          <div>
            <p style={{ color: "var(--text-dim)" }}>
              Ton rang actuel : <strong>{currentRank}</strong>. Objectifs du
              rang sélectionné ci-dessous.
            </p>
            <div className="grid grid-2">
              {filterRecords(rankRecords).map((r) => (
                <RecordCard key={r.hash} record={r} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
