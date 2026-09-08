"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import { BUNGIE_ROOT, CLASS_NAMES } from "@/lib/destiny-constants";
import { readStringVariables, type StringVariables } from "@/lib/string-variables";
import {
  buildArtifact,
  buildMilestones,
  buildRanks,
  buildRotation,
  timeLeft,
  type MilestoneView,
  type ObjectiveView,
} from "@/lib/weekly-engine";
import type { Character, Defs, ProfileResponse, PublicMilestone } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Section = "todo" | "rotation" | "ranks";

interface WeeklyPayload {
  profile: ProfileResponse;
  publicMilestones: Record<string, PublicMilestone> | null;
  error?: string;
}

function ObjectiveBar({ objective }: { objective: ObjectiveView }) {
  const pct =
    objective.total > 0
      ? Math.min(100, (objective.progress / objective.total) * 100)
      : objective.complete
        ? 100
        : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs opacity-80">
        <span className="truncate">{objective.label}</span>
        <span
          className={objective.complete ? "text-success" : "font-mono opacity-70"}
        >
          {objective.complete
            ? "✓"
            : objective.total > 1
              ? `${objective.progress} / ${objective.total}`
              : ""}
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

function MilestoneCard({ milestone }: { milestone: MilestoneView }) {
  const remaining = timeLeft(milestone.endDate);
  return (
    <div
      className={`card bg-base-200 shadow border ${
        milestone.complete ? "border-success/40" : "border-base-300"
      }`}
    >
      <div className="card-body p-4 gap-3">
        <div className="flex items-start gap-3">
          {milestone.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="item-icon !w-10 !h-10"
              src={`${BUNGIE_ROOT}${milestone.icon}`}
              alt=""
            />
          ) : null}
          <div className="flex-1 min-w-0">
            <h2 className="card-title text-base gap-2 flex-wrap">
              <span className="truncate">{milestone.name}</span>
              {milestone.complete && (
                <span className="badge badge-success badge-sm">terminé</span>
              )}
            </h2>
            <div className="flex gap-2 flex-wrap text-xs opacity-60 mt-0.5">
              <span className="uppercase">{milestone.cadence}</span>
              {remaining && <span>· expire dans {remaining}</span>}
            </div>
          </div>
        </div>

        {milestone.description && (
          <p className="text-xs opacity-70">{milestone.description}</p>
        )}

        {milestone.activities.map((activity) => (
          <div key={activity.hash} className="text-xs">
            <div className="font-medium opacity-80">{activity.name}</div>
            {activity.modifiers.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                {activity.modifiers.map((mod) => (
                  <span
                    key={mod.hash}
                    className="badge badge-ghost badge-sm gap-1"
                    title={mod.description}
                  >
                    {mod.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="w-3.5 h-3.5"
                        src={`${BUNGIE_ROOT}${mod.icon}`}
                        alt=""
                      />
                    )}
                    {mod.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {milestone.objectives.length > 0 && (
          <div className="flex flex-col gap-2">
            {milestone.objectives.map((o) => (
              <ObjectiveBar key={o.hash} objective={o} />
            ))}
          </div>
        )}

        {milestone.rewards.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {milestone.rewards.map((reward, i) => (
              <span
                key={`${reward.name}-${i}`}
                className={`badge badge-sm ${
                  reward.earned || reward.redeemed
                    ? "badge-success"
                    : "badge-outline"
                }`}
              >
                {reward.earned || reward.redeemed ? "✓ " : ""}
                {reward.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WeeklyPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [data, setData] = useState<WeeklyPayload | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [section, setSection] = useState<Section>("todo");
  const [hideDone, setHideDone] = useState(false);
  const [vars, setVars] = useState<StringVariables | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Lecture de ta progression…");

        const res = await fetch("/api/bungie/weekly");
        if (res.status === 401) {
          if (!cancelled) setPhase("unauth");
          return;
        }
        const payload = (await res.json()) as WeeklyPayload;
        if (!res.ok) throw new Error(payload.error ?? "Erreur profil");
        if (cancelled) return;

        setData(payload);
        setVars(readStringVariables(payload.profile));
        const chars = Object.values(payload.profile.characters?.data ?? {}).sort(
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
    const chars = Object.values(data?.profile.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [data]);

  const progressions = data?.profile.characterProgressions?.data?.[selectedChar];

  const milestones = useMemo(
    () =>
      defs ? buildMilestones(defs, progressions, vars, selectedChar) : [],
    [defs, progressions, vars, selectedChar]
  );

  const rotation = useMemo(
    () => (defs ? buildRotation(defs, data?.publicMilestones ?? null) : []),
    [defs, data]
  );

  const ranks = useMemo(
    () => (defs ? buildRanks(defs, progressions) : []),
    [defs, progressions]
  );

  const artifact = useMemo(
    () =>
      defs && data ? buildArtifact(defs, data.profile, selectedChar) : null,
    [defs, data, selectedChar]
  );

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
        <p className="opacity-70">Connecte-toi pour voir ta semaine.</p>
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

  const visibleMilestones = hideDone
    ? milestones.filter((m) => !m.complete)
    : milestones;
  const done = milestones.filter((m) => m.complete).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Cette semaine</h1>
        <span className="badge badge-ghost">
          {done}/{milestones.length} jalons terminés
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
            <div className="char-class">{CLASS_NAMES[c.classType] ?? "Gardien"}</div>
            <div className="char-light">✦ {c.light}</div>
          </button>
        ))}
      </div>

      {artifact && (
        <div className="card bg-base-200 shadow border border-base-300">
          <div className="card-body p-4 flex-row items-center gap-4 flex-wrap">
            {artifact.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="item-icon !w-12 !h-12"
                src={`${BUNGIE_ROOT}${artifact.icon}`}
                alt=""
              />
            ) : null}
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">{artifact.name}</div>
              <div className="text-xs opacity-60">
                {artifact.pointsAcquired} point
                {artifact.pointsAcquired > 1 ? "s" : ""} débloqué
                {artifact.pointsAcquired > 1 ? "s" : ""}
                {artifact.nextAt > 0 && (
                  <> · prochain dans {artifact.nextAt - artifact.progress} XP</>
                )}
              </div>
              {artifact.nextAt > 0 && (
                <progress
                  className="progress progress-primary h-1 mt-1.5 w-full max-w-md"
                  value={artifact.progress}
                  max={artifact.nextAt}
                />
              )}
            </div>
            <div className="stat p-0 text-right">
              <div className="stat-title text-xs">Bonus de puissance</div>
              <div className="stat-value text-2xl text-primary">
                +{artifact.powerBonus}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div role="tablist" className="tabs tabs-bordered">
          {(
            [
              ["todo", `À faire (${milestones.length})`],
              ["rotation", `Rotation (${rotation.length})`],
              ["ranks", `Réputations (${ranks.length})`],
            ] as [Section, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              className={`tab${section === value ? " tab-active" : ""}`}
              onClick={() => setSection(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {section === "todo" && (
          <label className="label cursor-pointer justify-start gap-3 py-0">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="toggle toggle-primary toggle-sm"
            />
            <span className="label-text text-sm">Masquer ce qui est fait</span>
          </label>
        )}
      </div>

      {section === "todo" &&
        (visibleMilestones.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Aucun jalon en cours pour ce personnage.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleMilestones.map((m) => (
              <MilestoneCard key={m.hash} milestone={m} />
            ))}
          </div>
        ))}

      {section === "rotation" &&
        (rotation.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Bungie ne publie pas de rotation en ce moment.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rotation.map((m) => (
              <MilestoneCard key={m.hash} milestone={m} />
            ))}
          </div>
        ))}

      {section === "ranks" &&
        (ranks.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Aucune réputation entamée sur ce personnage.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {ranks.map((rank) => (
              <div
                key={rank.hash}
                className="card bg-base-200 shadow border border-base-300"
              >
                <div className="card-body p-4 gap-2">
                  <div className="flex items-center gap-3">
                    {rank.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="item-icon !w-10 !h-10"
                        src={`${BUNGIE_ROOT}${rank.icon}`}
                        alt=""
                      />
                    ) : null}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{rank.name}</div>
                      <div className="text-xs opacity-60">
                        {rank.stepName ?? `Rang ${rank.level}`}
                        {rank.levelCap > 0 && ` · ${rank.level}/${rank.levelCap}`}
                        {rank.resets > 0 && ` · ${rank.resets} reset`}
                        {rank.resets > 1 && "s"}
                      </div>
                    </div>
                  </div>
                  {rank.nextAt > 0 && (
                    <div>
                      <progress
                        className="progress progress-primary h-1.5"
                        value={rank.progress}
                        max={rank.nextAt}
                      />
                      <div className="text-xs opacity-60 font-mono text-right mt-0.5">
                        {rank.progress} / {rank.nextAt}
                      </div>
                    </div>
                  )}
                  {rank.weeklyLimit ? (
                    <div className="text-xs opacity-60">
                      Cette semaine : {rank.weeklyProgress ?? 0} /{" "}
                      {rank.weeklyLimit}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}

      <p className="text-xs opacity-50">
        Les jalons viennent du composant <code>CharacterProgressions</code> :
        c&apos;est exactement ce que le jeu affiche dans le Directeur, coffre
        hebdomadaire compris. La rotation, elle, est publique — elle vaut pour
        tout le monde, même hors connexion au jeu.
      </p>
    </div>
  );
}
