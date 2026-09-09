"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RaIcon from "@/components/RaIcon";
import { loadDefs } from "@/lib/manifest-client";
import { BUNGIE_ROOT } from "@/lib/destiny-constants";
import { ICONS, familyStyle } from "@/lib/rpg-icons";
import {
  buildDashboard,
  POSTMASTER_CAP,
  type Alert,
  type CharacterCard,
  type DashboardView,
  type RecentActivity,
} from "@/lib/dashboard-engine";
import {
  formatNumber,
  nextDailyReset,
  nextWeeklyReset,
  until,
} from "@/lib/weekly-engine";
import { formatDuration, formatWhen } from "@/lib/activity-client";
import type { ActivityHistoryPage, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

interface DashboardPayload {
  profile: ProfileResponse;
  recent?: Record<string, ActivityHistoryPage> | null;
  error?: string;
}

const ERRORS: Record<string, string> = {
  oauth_state:
    "La vérification de sécurité OAuth a échoué (state invalide). Réessaie de te connecter.",
  oauth_exchange:
    "L'échange du code OAuth a échoué. Vérifie BUNGIE_CLIENT_ID / BUNGIE_CLIENT_SECRET et la Redirect URL de ton app Bungie.",
};

/** Les pages du site, avec ce qu'elles apportent en une phrase. */
const PAGES = [
  {
    href: "/perso",
    icon: ICONS.character,
    title: "Personnage",
    desc: "Ton Gardien comme en jeu : armes, armure, mods.",
  },
  {
    href: "/semaine",
    icon: ICONS.time,
    title: "Cette semaine",
    desc: "Jalons, modificateurs, réputations, artefact.",
  },
  {
    href: "/quests",
    icon: ICONS.quest,
    title: "Quêtes",
    desc: "Poursuites, défis saisonniers et rangs de Gardien.",
  },
  {
    href: "/activite",
    icon: ICONS.history,
    title: "Activité",
    desc: "Ton historique, ta carrière, ton clan.",
  },
  {
    href: "/armes",
    icon: ICONS.weapon,
    title: "Armes",
    desc: "Tout l'arsenal, perks et mods compris.",
  },
  {
    href: "/postmaster",
    icon: ICONS.postmaster,
    title: "Maître des postes",
    desc: "Ce qui t'attend sur chaque personnage.",
  },
  {
    href: "/marchands",
    icon: ICONS.vendor,
    title: "Marchands",
    desc: "Ce qui vaut le détour aujourd'hui.",
  },
  {
    href: "/optimizer",
    icon: ICONS.optimizer,
    title: "Optimiseur",
    desc: "Assemblages d'armure et puissance maximale.",
  },
  {
    href: "/loadouts",
    icon: ICONS.loadout,
    title: "Loadouts",
    desc: "Enregistre un personnage complet, réapplique-le.",
  },
  {
    href: "/clan",
    icon: ICONS.clan,
    title: "Clan",
    desc: "Le roster et la fiche de chaque membre.",
  },
];

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState<string | null>(null);
  const [defs, setDefs] = useState<Defs | null>(null);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Fait vivre les comptes à rebours sans relire le profil.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchDashboard = useCallback(async () => {
    const res = await fetch(`/api/bungie/dashboard?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (res.status === 401) {
      setPhase("unauth");
      return;
    }
    const data = (await res.json()) as DashboardPayload;
    if (!res.ok) throw new Error(data.error ?? "Erreur profil");
    setPayload(data);
    setPhase("ready");
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(ERRORS[code] ?? "Erreur inconnue.");

    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Lecture de ton compte…");
        await fetchDashboard();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDashboard]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setRefreshing(false);
    }
  }

  const view: DashboardView | null = useMemo(
    () => (defs && payload ? buildDashboard(defs, payload) : null),
    [defs, payload]
  );

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 opacity-70">
        <span className="loading loading-spinner loading-lg text-primary" />
        <div className="text-sm">{statusMsg}</div>
      </div>
    );
  }

  if (phase === "unauth") return <SignedOut error={error} />;

  if (phase === "error" || !view) {
    return (
      <div role="alert" className="alert alert-error">
        <span>{error ?? "Tableau de bord indisponible."}</span>
      </div>
    );
  }

  const weeklyIn = until(nextWeeklyReset());
  const dailyIn = until(nextDailyReset());
  const milestonesLeft = view.characters.reduce(
    (a, c) => a + c.milestonesLeft,
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <Header view={view} onRefresh={refresh} refreshing={refreshing} />

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      {view.alerts.length > 0 && <Alerts alerts={view.alerts} />}

      {/* ── Les six nombres qui décident de la session ── */}
      <div className="flex flex-wrap gap-3">
        <KeyFigure
          icon={ICONS.power}
          label="Puissance"
          value={String(view.power.total)}
          hint={`${view.power.gear} d'équipement + ${view.power.artifact} d'artefact`}
          accent="text-[#ffd970]"
        />
        <KeyFigure
          icon={ICONS.rank}
          label="Rang de Gardien"
          value={String(view.guardianRank)}
          hint={view.guardianRankName || `Record : ${view.highestGuardianRank}`}
        />
        {view.seasonPass && (
          <KeyFigure
            icon={ICONS.seasonPass}
            label="Pass de saison"
            value={
              view.seasonPass.capped
                ? `${view.seasonPass.level}+${view.seasonPass.prestigeLevel}`
                : String(view.seasonPass.level)
            }
            hint={view.seasonPass.name}
          />
        )}
        <KeyFigure
          icon={ICONS.challenge}
          label="Jalons à finir"
          value={String(milestonesLeft)}
          hint={
            milestonesLeft === 0
              ? "Tout est fait sur tes personnages"
              : "Sur l'ensemble de tes personnages"
          }
          accent={milestonesLeft === 0 ? "text-success" : undefined}
        />
        <KeyFigure
          icon={ICONS.reset}
          label="Reset hebdomadaire"
          value={weeklyIn ?? "imminent"}
          hint="Mardi 18 h (heure de Paris)"
        />
        <KeyFigure
          icon={ICONS.time}
          label="Reset quotidien"
          value={dailyIn ?? "imminent"}
          hint="Chaque jour à 18 h"
        />
      </div>

      {/* ── Tes personnages ── */}
      <section className="flex flex-col gap-3">
        <SectionTitle icon={ICONS.character} title="Tes personnages" />
        <div className="flex flex-wrap gap-4">
          {view.characters.map((c) => (
            <CharacterPanel key={c.characterId} card={c} />
          ))}
        </div>
      </section>

      {/* ── Progression de saison ── */}
      {(view.artifact || view.seasonPass) && (
        <section className="flex flex-col gap-3">
          <SectionTitle
            icon={ICONS.seasonPass}
            title={view.seasonName || "Saison en cours"}
          />
          <div className="flex flex-wrap gap-4">
            {view.artifact && (
              <ProgressPanel
                icon={ICONS.artifact}
                image={view.artifact.icon}
                title={view.artifact.name}
                subtitle={`${view.artifact.pointsAcquired} mod${
                  view.artifact.pointsAcquired > 1 ? "s" : ""
                } débloqué${view.artifact.pointsAcquired > 1 ? "s" : ""}`}
                highlight={`+${view.artifact.powerBonus}`}
                highlightLabel="puissance"
                progress={view.artifact.progress}
                total={view.artifact.nextAt}
                footer="Le bonus s'applique à tout ton équipement."
              />
            )}
            {view.seasonPass && (
              <ProgressPanel
                icon={ICONS.seasonPass}
                image={view.seasonPass.icon}
                title={view.seasonPass.name}
                subtitle={
                  view.seasonPass.capped
                    ? `Prestige ${view.seasonPass.prestigeLevel}`
                    : `Rang ${view.seasonPass.level}/${view.seasonPass.levelCap}`
                }
                highlight={String(view.seasonPass.level)}
                highlightLabel="rang"
                progress={view.seasonPass.progress}
                total={view.seasonPass.nextAt}
                footer="Chaque rang livre une récompense du pass."
              />
            )}
          </div>
        </section>
      )}

      {/* ── Réputations ── */}
      {view.ranks.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle
            icon={ICONS.reputation}
            title="Réputations"
            action={{ href: "/semaine", label: "Tout voir" }}
          />
          <div className="flex flex-wrap gap-3">
            {view.ranks.slice(0, 6).map((rank) => {
              const room =
                rank.weeklyLimit && rank.weeklyLimit > (rank.weeklyProgress ?? 0)
                  ? rank.weeklyLimit - (rank.weeklyProgress ?? 0)
                  : 0;
              return (
                <div
                  key={rank.hash}
                  className="card bg-base-200 border border-base-300 shadow grow basis-64 max-w-sm"
                >
                  <div className="card-body p-3 gap-1.5">
                    <div className="flex items-center gap-2.5">
                      {rank.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="w-8 h-8 rounded"
                          src={`${BUNGIE_ROOT}${rank.icon}`}
                          alt=""
                        />
                      ) : (
                        <RaIcon
                          icon={ICONS.reputation}
                          className="text-xl opacity-60"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {rank.name}
                        </div>
                        <div className="text-xs opacity-60 truncate">
                          {rank.stepName ?? `Rang ${rank.level}`}
                          {rank.resets > 0 && ` · ↻ ${rank.resets}`}
                        </div>
                      </div>
                    </div>
                    {rank.nextAt > 0 && (
                      <progress
                        className="progress progress-primary h-1"
                        value={rank.progress}
                        max={rank.nextAt}
                      />
                    )}
                    <div
                      className={`text-xs ${room > 0 ? "text-primary" : "opacity-50"}`}
                    >
                      {rank.atCap
                        ? "Rang maximum — réinitialise pour continuer"
                        : room > 0
                          ? `Encore ${formatNumber(room)} XP cette semaine`
                          : rank.weeklyLimit
                            ? "Plafond hebdomadaire atteint"
                            : `${formatNumber(rank.remaining)} XP avant le rang suivant`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Dernières parties ── */}
      {view.recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle
            icon={ICONS.history}
            title="Dernières parties"
            action={{ href: "/activite", label: "Tout l'historique" }}
          />
          <div className="card bg-base-200 shadow border border-base-300">
            <div className="card-body p-2">
              <div className="flex flex-col divide-y divide-base-300">
                {view.recent.map((row) => (
                  <RecentRow key={row.instanceId} row={row} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Devises ── */}
      {view.currencies.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle icon={ICONS.currency} title="Devises" />
          <div className="flex flex-wrap gap-2">
            {view.currencies.map((c) => (
              <div
                key={c.itemHash}
                className="flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-3 py-2"
                title={c.name}
              >
                {c.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="w-6 h-6 rounded"
                    src={`${BUNGIE_ROOT}${c.icon}`}
                    alt=""
                  />
                )}
                <div className="leading-tight">
                  <div className="font-mono text-sm">
                    {formatNumber(c.quantity)}
                  </div>
                  <div className="text-[10px] opacity-50 max-w-28 truncate">
                    {c.name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Le reste du site ── */}
      <section className="flex flex-col gap-3">
        <SectionTitle icon={ICONS.activity} title="Aller plus loin" />
        <div className="flex flex-wrap gap-3">
          {PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="card bg-base-200 border border-base-300 shadow hover:border-primary transition-colors grow basis-64 max-w-sm"
            >
              <div className="card-body p-4 flex-row items-center gap-3">
                <RaIcon icon={p.icon} className="text-2xl text-primary" />
                <div className="min-w-0">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs opacity-60">{p.desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-xs opacity-50 max-w-3xl">
        Tout vient d&apos;un seul appel au profil Bungie : puissance et sceaux
        depuis <code>Characters</code>, jalons et réputations depuis{" "}
        <code>CharacterProgressions</code>, devises depuis{" "}
        <code>ProfileCurrencies</code>, et l&apos;activité en cours depuis{" "}
        <code>CharacterActivities</code> — celle-là change pendant que tu joues,
        d&apos;où le bouton de rafraîchissement.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------------

function Header({
  view,
  onRefresh,
  refreshing,
}: {
  view: DashboardView;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        {view.playerIcon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="w-12 h-12 rounded-box border border-base-300"
            src={`${BUNGIE_ROOT}${view.playerIcon}`}
            alt=""
          />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">
            {view.playerName}
            {view.playerCode !== undefined && (
              <span className="opacity-40 text-lg font-normal">
                #{String(view.playerCode).padStart(4, "0")}
              </span>
            )}
          </h1>
          <div className="text-sm opacity-60">
            {view.guardianRankName
              ? `${view.guardianRankName} · rang ${view.guardianRank}`
              : `Rang de Gardien ${view.guardianRank}`}
            {view.totalHoursPlayed > 0 &&
              ` · ${formatNumber(view.totalHoursPlayed)} h de jeu`}
          </div>
        </div>
      </div>
      <button
        className="btn btn-sm btn-outline btn-primary"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <RaIcon icon={ICONS.reset} />
        )}
        Rafraîchir
      </button>
    </div>
  );
}

function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="flex flex-col gap-2">
      {alerts.map((a) => (
        <div
          key={a.key}
          role="alert"
          className={`alert py-2 text-sm ${
            a.level === "danger"
              ? "alert-error"
              : a.level === "warning"
                ? "alert-warning"
                : "alert-info"
          }`}
        >
          <RaIcon icon={a.icon} className="text-lg" />
          <span>
            <span className="font-medium">{a.title}</span>
            <span className="opacity-80"> — {a.detail}</span>
          </span>
          {a.href && (
            <Link href={a.href} className="btn btn-xs">
              Ouvrir
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  action,
}: {
  icon: string;
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-base-300 pb-1.5">
      <h2 className="font-semibold flex items-center gap-2">
        <RaIcon icon={icon} className="text-primary" />
        {title}
      </h2>
      <div className="flex-1" />
      {action && (
        <Link href={action.href} className="text-xs link link-hover opacity-70">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

/**
 * Un nombre isolé, assez large pour être lu de loin.
 * `grow basis-*` : les tuiles se partagent la ligne selon la place disponible
 * plutôt que de se répartir en colonnes fixes.
 */
function KeyFigure({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="card bg-base-200 border border-base-300 shadow grow basis-44 max-w-xs">
      <div className="card-body p-4 gap-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-60">
          <RaIcon icon={icon} className="text-base" />
          {label}
        </div>
        <div
          className={`text-3xl font-light leading-none ${accent ?? "text-primary"}`}
        >
          {value}
        </div>
        {hint && <div className="text-xs opacity-50">{hint}</div>}
      </div>
    </div>
  );
}

function CharacterPanel({ card }: { card: CharacterCard }) {
  const activity = card.currentActivity;
  const style = activity ? familyStyle(activity.family) : null;

  return (
    <div className="card shadow border border-base-300 overflow-hidden grow basis-80 max-w-md">
      <div
        className="bg-cover bg-center"
        style={
          card.emblemBackgroundPath
            ? {
                backgroundImage: `linear-gradient(to right, rgba(20,24,31,.92), rgba(20,24,31,.75)), url(${BUNGIE_ROOT}${card.emblemBackgroundPath})`,
              }
            : { background: "oklch(var(--b2))" }
        }
      >
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold tracking-wide">{card.className}</div>
              <div className="text-xs opacity-60 truncate">
                {card.title ?? `${formatNumber(card.hoursPlayed)} h de jeu`}
              </div>
            </div>
            <div className="text-right leading-none">
              <div className="text-2xl font-light text-[#ffd970]">
                ✦ {card.light}
              </div>
              <div className="text-[10px] opacity-50 mt-1">
                équipement {card.gearPower}
              </div>
            </div>
          </div>

          {activity && style ? (
            <div className="flex items-center gap-2 text-xs bg-base-100/60 rounded px-2 py-1.5">
              <RaIcon icon={style.icon} className={`text-base ${style.color}`} />
              <span className="min-w-0">
                <span className="font-medium">En jeu : {activity.name}</span>
                {activity.modeName && (
                  <span className="opacity-60"> · {activity.modeName}</span>
                )}
              </span>
            </div>
          ) : (
            <div className="text-xs opacity-50">
              Vu {formatWhen(card.lastPlayed)}
            </div>
          )}

          <div className="flex gap-2 flex-wrap text-xs">
            <MiniStat
              icon={ICONS.challenge}
              value={`${card.milestonesLeft}`}
              label="jalons"
              alert={false}
            />
            <MiniStat
              icon={ICONS.bounty}
              value={`${card.pursuits.total}`}
              label="poursuites"
              alert={card.pursuits.expiringSoon > 0}
            />
            <MiniStat
              icon={ICONS.postmaster}
              value={`${card.postmaster.count}/${POSTMASTER_CAP}`}
              label="postes"
              alert={card.postmaster.urgent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
  alert,
}: {
  icon: string;
  value: string;
  label: string;
  alert: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 border ${
        alert
          ? "border-warning/60 text-warning"
          : "border-base-300 opacity-80"
      }`}
    >
      <RaIcon icon={icon} className="text-sm" />
      <span className="font-mono">{value}</span>
      <span className="opacity-60">{label}</span>
    </span>
  );
}

function ProgressPanel({
  icon,
  image,
  title,
  subtitle,
  highlight,
  highlightLabel,
  progress,
  total,
  footer,
}: {
  icon: string;
  image?: string;
  title: string;
  subtitle: string;
  highlight: string;
  highlightLabel: string;
  progress: number;
  total: number;
  footer: string;
}) {
  return (
    <div className="card bg-base-200 border border-base-300 shadow grow basis-80 max-w-xl">
      <div className="card-body p-4 gap-2">
        <div className="flex items-center gap-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="item-icon !w-10 !h-10"
              src={`${BUNGIE_ROOT}${image}`}
              alt=""
            />
          ) : (
            <RaIcon icon={icon} className="text-2xl text-primary" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{title}</div>
            <div className="text-xs opacity-60 truncate">{subtitle}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-semibold text-primary leading-none">
              {highlight}
            </div>
            <div className="text-[10px] opacity-50 uppercase tracking-wider">
              {highlightLabel}
            </div>
          </div>
        </div>
        {total > 0 && (
          <>
            <progress
              className="progress progress-primary h-1.5"
              value={progress}
              max={total}
            />
            <div className="text-xs opacity-70">
              Encore{" "}
              <span className="font-mono">{formatNumber(total - progress)} XP</span>{" "}
              · {footer}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RecentRow({ row }: { row: RecentActivity }) {
  const style = familyStyle(row.family);
  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <RaIcon icon={style.icon} className={`text-xl w-6 shrink-0 ${style.color}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{row.name}</div>
        <div className="text-xs opacity-55 flex gap-1.5 flex-wrap">
          <span>{row.modeName || style.label}</span>
          <span>· {row.className}</span>
          {row.standing === 0 && <span className="text-success">· victoire</span>}
          {row.standing === 1 && <span className="text-error">· défaite</span>}
          {row.standing === undefined && !row.completed && (
            <span className="text-warning">· abandonnée</span>
          )}
        </div>
      </div>
      <div className="text-xs font-mono opacity-70 text-right shrink-0">
        <div>
          {row.kills} / {row.deaths}
        </div>
        <div className="opacity-60">{formatDuration(row.durationSeconds)}</div>
      </div>
      <div className="text-xs opacity-50 w-20 text-right shrink-0">
        {formatWhen(row.date)}
      </div>
    </div>
  );
}

function SignedOut({ error }: { error: string | null }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="hero py-12">
        <div className="hero-content text-center flex-col">
          <h1 className="text-4xl font-semibold tracking-widest uppercase">
            DIM Perso
          </h1>
          <p className="max-w-xl opacity-70">
            Ton armurerie Destiny 2 personnelle : puissance, jalons, arsenal et
            loadouts complets — branchée en direct sur ton compte Bungie.
          </p>
          <a className="btn btn-primary" href="/api/auth/login">
            Se connecter avec Bungie.net
          </a>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {PAGES.map((p) => (
          <div
            key={p.href}
            className="card bg-base-200 border border-base-300 grow basis-64 max-w-sm"
          >
            <div className="card-body p-4 flex-row items-center gap-3">
              <RaIcon icon={p.icon} className="text-2xl text-primary" />
              <div className="min-w-0">
                <div className="font-medium">{p.title}</div>
                <div className="text-xs opacity-60">{p.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
