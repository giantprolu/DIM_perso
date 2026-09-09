"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import { BUNGIE_ROOT, CLASS_NAMES } from "@/lib/destiny-constants";
import { readStringVariables, type StringVariables } from "@/lib/string-variables";
import {
  CADENCES,
  buildArtifact,
  buildMilestones,
  buildRanks,
  buildRotation,
  buildSeasonPass,
  formatNumber,
  nextDailyReset,
  nextWeeklyReset,
  timeLeft,
  until,
  type Cadence,
  type MilestoneView,
  type ObjectiveView,
  type RankView,
} from "@/lib/weekly-engine";
import type { Character, Defs, ProfileResponse, PublicMilestone } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Section = "todo" | "rotation" | "ranks";

interface WeeklyPayload {
  profile: ProfileResponse;
  publicMilestones: Record<string, PublicMilestone> | null;
  error?: string;
}

/** Ce que chaque onglet apporte, dit en une phrase. */
const SECTION_HELP: Record<Section, string> = {
  todo: "Ce que ton personnage peut encore terminer avant la réinitialisation. Une case cochée, c'est une récompense qui t'attend au Directeur.",
  rotation:
    "Les activités et modificateurs de la semaine, identiques pour tous les joueurs. À lire avant de choisir ton build.",
  ranks:
    "Où en sont tes réputations. Monter un rang débloque des récompenses chez le marchand correspondant ; une réinitialisation relance la piste depuis zéro.",
};

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
              ? `${formatNumber(objective.progress)} / ${formatNumber(objective.total)}`
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
  const pending = milestone.rewards.filter((r) => !r.earned && !r.redeemed);
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
          <div className="flex flex-col gap-1.5">
            <div className="text-xs opacity-50">
              {pending.length > 0 ? "À récupérer" : "Récompenses"}
            </div>
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
          </div>
        )}
      </div>
    </div>
  );
}

function RankCard({ rank }: { rank: RankView }) {
  const weeklyLeft =
    rank.weeklyLimit && rank.weeklyLimit > (rank.weeklyProgress ?? 0)
      ? rank.weeklyLimit - (rank.weeklyProgress ?? 0)
      : 0;

  return (
    <div className="card bg-base-200 shadow border border-base-300">
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
            <div className="text-xs opacity-60 truncate">
              {rank.stepName ?? `Rang ${rank.level}`}
              {rank.levelCap > 0 && ` · rang ${rank.level}/${rank.levelCap}`}
            </div>
          </div>
          {rank.resets > 0 && (
            <span
              className="badge badge-ghost badge-sm"
              title="Réinitialisations de la piste, saison en cours comprise"
            >
              ↻ {rank.resets}
            </span>
          )}
        </div>

        {rank.nextAt > 0 && (
          <div>
            <progress
              className="progress progress-primary h-1.5"
              value={rank.progress}
              max={rank.nextAt}
            />
            <div className="flex justify-between gap-2 text-xs opacity-70 mt-1">
              <span className="truncate">
                {rank.atCap
                  ? "Rang maximum atteint"
                  : rank.nextStepName
                    ? `Prochain : ${rank.nextStepName}`
                    : "Prochain rang"}
              </span>
              <span className="font-mono whitespace-nowrap">
                {formatNumber(rank.remaining)} XP
              </span>
            </div>
          </div>
        )}

        {rank.weeklyLimit ? (
          <div
            className={`text-xs ${weeklyLeft > 0 ? "text-primary" : "opacity-50"}`}
          >
            {weeklyLeft > 0
              ? `Encore ${formatNumber(weeklyLeft)} XP à gagner cette semaine`
              : "Plafond hebdomadaire atteint"}
          </div>
        ) : null}
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
  // Fait avancer les comptes à rebours sans recharger le profil.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const seasonPass = useMemo(
    () =>
      defs && data ? buildSeasonPass(defs, data.profile, progressions) : null,
    [defs, data, progressions]
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
  const todo = milestones.filter((m) => !m.complete);
  const weeklyIn = until(nextWeeklyReset());
  const dailyIn = until(nextDailyReset());

  /* Les jalons regroupés par rythme : l'hebdomadaire d'abord, c'est lui qui
     expire au prochain mardi. */
  const CADENCE_HINT: Record<Cadence, string> = {
    weekly: weeklyIn ? `Tout repart dans ${weeklyIn}` : "Expire au prochain reset",
    daily: dailyIn ? `Tout repart dans ${dailyIn}` : "Repart au reset quotidien",
    event: "Limité dans le temps",
    other: "Reste disponible tant que tu ne l'as pas fait",
  };
  const groups = CADENCES.map(({ key, label }) => ({
    key,
    label,
    hint: CADENCE_HINT[key],
    items: visibleMilestones.filter((m) => m.cadenceKey === key),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Cette semaine</h1>
          <p className="text-sm opacity-60 mt-0.5">
            {todo.length === 0
              ? "Tout est fait sur ce personnage."
              : `${todo.length} chose${todo.length > 1 ? "s" : ""} à faire sur ce personnage`}
            {weeklyIn && ` · reset hebdomadaire dans ${weeklyIn}`}
            {dailyIn && ` · reset quotidien dans ${dailyIn}`}
          </p>
        </div>
        <span className="badge badge-ghost">
          {milestones.length - todo.length}/{milestones.length} jalons terminés
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

      {(seasonPass || artifact) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {seasonPass && (
            <div className="card bg-base-200 shadow border border-base-300">
              <div className="card-body p-4 gap-2">
                <div className="flex items-center gap-3">
                  {seasonPass.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="item-icon !w-10 !h-10"
                      src={`${BUNGIE_ROOT}${seasonPass.icon}`}
                      alt=""
                    />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      Pass de saison · {seasonPass.name}
                    </div>
                    <div className="text-xs opacity-60 truncate">
                      {seasonPass.seasonName}
                      {seasonPass.capped
                        ? ` · prestige ${seasonPass.prestigeLevel}`
                        : seasonPass.levelCap > 0 &&
                          ` · rang ${seasonPass.level}/${seasonPass.levelCap}`}
                    </div>
                  </div>
                </div>
                {seasonPass.nextAt > 0 && (
                  <div>
                    <progress
                      className="progress progress-primary h-1.5"
                      value={seasonPass.progress}
                      max={seasonPass.nextAt}
                    />
                    <div className="text-xs opacity-70 mt-1">
                      Prochain rang dans{" "}
                      <span className="font-mono">
                        {formatNumber(seasonPass.nextAt - seasonPass.progress)} XP
                      </span>{" "}
                      · chaque rang livre une récompense du pass
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {artifact && (
            <div className="card bg-base-200 shadow border border-base-300">
              <div className="card-body p-4 gap-2">
                <div className="flex items-center gap-3">
                  {artifact.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="item-icon !w-10 !h-10"
                      src={`${BUNGIE_ROOT}${artifact.icon}`}
                      alt=""
                    />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{artifact.name}</div>
                    <div className="text-xs opacity-60">
                      {artifact.pointsAcquired} mod
                      {artifact.pointsAcquired > 1 ? "s" : ""} d&apos;artefact
                      débloqué{artifact.pointsAcquired > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs opacity-60">Puissance</div>
                    <div className="text-2xl font-semibold text-primary leading-none">
                      +{artifact.powerBonus}
                    </div>
                  </div>
                </div>
                {artifact.nextAt > 0 && (
                  <div>
                    <progress
                      className="progress progress-primary h-1.5"
                      value={artifact.progress}
                      max={artifact.nextAt}
                    />
                    <div className="text-xs opacity-70 mt-1">
                      Prochain mod dans{" "}
                      <span className="font-mono">
                        {formatNumber(artifact.nextAt - artifact.progress)} XP
                      </span>{" "}
                      · le bonus s&apos;applique à tout ton équipement
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div role="tablist" className="tabs tabs-bordered">
          {(
            [
              ["todo", `À faire (${todo.length})`],
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

      <p className="text-sm opacity-60 -mt-1 max-w-3xl">{SECTION_HELP[section]}</p>

      {section === "todo" &&
        (visibleMilestones.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Aucun jalon en cours pour ce personnage.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) =>
              group.items.length === 0 ? null : (
                <section key={group.key} className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-3 flex-wrap border-b border-base-300 pb-1.5">
                    <h2 className="font-semibold">
                      {group.label}{" "}
                      <span className="opacity-50 font-normal">
                        ({group.items.length})
                      </span>
                    </h2>
                    <span className="text-xs opacity-50">{group.hint}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {group.items.map((m) => (
                      <MilestoneCard key={m.hash} milestone={m} />
                    ))}
                  </div>
                </section>
              )
            )}
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
              <RankCard key={rank.hash} rank={rank} />
            ))}
          </div>
        ))}

      <p className="text-xs opacity-50 max-w-3xl">
        Les jalons viennent du composant <code>CharacterProgressions</code> :
        c&apos;est exactement ce que le jeu affiche dans le Directeur, coffre
        hebdomadaire compris. La rotation, elle, est publique — elle vaut pour
        tout le monde, même hors connexion au jeu. Les réputations ne gardent
        que les pistes qui portent un nom et une description : cela écarte les
        quarante-deux compteurs internes que le manifest appelle tous
        «&nbsp;EXP&nbsp;» ou «&nbsp;Prestige&nbsp;». Le niveau de saison, lui,
        est remonté plus haut sous le nom de son pass.
      </p>
    </div>
  );
}
