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
} from "@/lib/destiny-constants";
import type {
  Character,
  Defs,
  ObjectiveProgress,
  ProfileResponse,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Tab = "all" | "quests" | "bounties";

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

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expirée";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `Expire dans ${Math.floor(h / 24)} j`;
  if (h >= 1) return `Expire dans ${h} h ${m.toString().padStart(2, "0")}`;
  return `Expire dans ${m} min`;
}

export default function QuestsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState<string>("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState<string>("");
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState("");

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
      const complete =
        visible.length > 0 && visible.every((o) => o.complete);

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

    // Non terminées d'abord, puis alphabétique
    list.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return a.name.localeCompare(b.name, "fr");
    });
    return list;
  }, [defs, profile, selectedChar]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return pursuits.filter((p) => {
      if (tab === "quests" && !p.isQuest) return false;
      if (tab === "bounties" && !p.isBounty) return false;
      if (!f) return true;
      return (
        p.name.toLowerCase().includes(f) ||
        p.typeName.toLowerCase().includes(f) ||
        p.description.toLowerCase().includes(f)
      );
    });
  }, [pursuits, tab, filter]);

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
      <h1>Quêtes &amp; primes</h1>

      <div className="char-row">
        {characters.map((c) => (
          <button
            key={c.characterId}
            className={`char-btn${selectedChar === c.characterId ? " active" : ""}`}
            style={
              c.emblemBackgroundPath
                ? { backgroundImage: `url(${BUNGIE_ROOT}${c.emblemBackgroundPath})` }
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
            ["all", "Tout"],
            ["quests", "Quêtes"],
            ["bounties", "Primes"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={`tab${tab === value ? " active" : ""}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
        <input
          className="search-input"
          placeholder="Filtrer par nom, type…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <div className="status">Aucune poursuite ne correspond.</div>
      ) : (
        <div className="grid grid-2">
          {shown.map((p) => (
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
                {p.description && <p className="item-desc">{p.description}</p>}
                {p.objectives.map((o) => {
                  const objDef = defs?.objectives[o.objectiveHash];
                  const cv = o.completionValue || objDef?.completionValue || 0;
                  const progress = o.progress ?? (o.complete ? cv : 0);
                  const pct =
                    cv > 0
                      ? Math.min(100, (progress / cv) * 100)
                      : o.complete
                        ? 100
                        : 0;
                  return (
                    <div className="objective" key={o.objectiveHash}>
                      <div className="objective-label">
                        <span>
                          {objDef?.progressDescription || "Progression"}
                        </span>
                        <span className={o.complete ? "done" : ""}>
                          {o.complete
                            ? "✓"
                            : cv > 1
                              ? `${progress} / ${cv}`
                              : ""}
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className={`progress-fill${o.complete ? " done" : ""}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="note">
        {shown.length} poursuite{shown.length > 1 ? "s" : ""} affichée
        {shown.length > 1 ? "s" : ""} pour ce personnage.
      </p>
    </div>
  );
}
