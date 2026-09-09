"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RaIcon from "@/components/RaIcon";
import { loadDefs } from "@/lib/manifest-client";
import { BUNGIE_ROOT, CLASS_NAMES } from "@/lib/destiny-constants";
import { FAMILIES, ICONS, familyStyle, type ActivityFamily } from "@/lib/rpg-icons";
import {
  fetchAccountStats,
  fetchAggregate,
  fetchClanStats,
  fetchHistory,
  fetchPgcr,
  fetchRecentWeapons,
  fetchWeapons,
  formatDuration,
  formatPlaytime,
  mergeActivityRows,
  toActivityRows,
  toAggregateRows,
  toCareerView,
  toPgcrView,
  toRecentWeaponRows,
  toWeaponRows,
  type ActivityRow,
  type AggregateRow,
  type CareerView,
  type ClanMemberStats,
  type PgcrView,
  type RecentWeaponRow,
  type WeaponRow,
} from "@/lib/activity-client";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Tab = "history" | "career" | "weapons" | "clan";

/** Parties lues par personnage à chaque page d'historique. */
const PER_PAGE = 20;
/** Parties relues pour reconstituer l'usage des armes. */
const WEAPON_GAMES = 25;

const TABS: [Tab, string, string][] = [
  ["history", "Historique", ICONS.history],
  ["career", "Carrière", ICONS.rank],
  ["weapons", "Armes", ICONS.weapon],
  ["clan", "Clan", ICONS.clan],
];

export default function ActivityPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [tab, setTab] = useState<Tab>("history");

  // ---- Historique ----
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [page, setPage] = useState(0);
  const [families, setFamilies] = useState<Set<ActivityFamily>>(new Set());
  const [charFilter, setCharFilter] = useState<string>("all");
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [exhausted, setExhausted] = useState(false);

  // ---- Carrière ----
  const [career, setCareer] = useState<CareerView | null>(null);
  const [aggregate, setAggregate] = useState<AggregateRow[] | null>(null);

  // ---- Armes ----
  const [weaponChar, setWeaponChar] = useState("");
  const [recentWeapons, setRecentWeapons] = useState<RecentWeaponRow[] | null>(
    null
  );
  const [weaponGames, setWeaponGames] = useState(0);
  const [exotics, setExotics] = useState<WeaponRow[] | null>(null);
  const [weaponError, setWeaponError] = useState("");

  // ---- Clan ----
  const [clan, setClan] = useState<{
    clanName: string | null;
    members: ClanMemberStats[];
  } | null>(null);
  const [clanBusy, setClanBusy] = useState(false);
  const [clanError, setClanError] = useState("");
  const [clanSort, setClanSort] = useState<ClanSortKey>("secondsPlayed");

  const [report, setReport] = useState<PgcrView | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Lecture de tes personnages…");

        const res = await fetch("/api/bungie/profile?scope=characters");
        if (res.status === 401) {
          if (!cancelled) setPhase("unauth");
          return;
        }
        const data = (await res.json()) as ProfileResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur profil");
        if (cancelled) return;

        const chars = Object.values(data.characters?.data ?? {}).sort(
          (a, b) =>
            new Date(b.dateLastPlayed).getTime() -
            new Date(a.dateLastPlayed).getTime()
        );
        setCharacters(chars);
        if (chars.length > 0) setWeaponChar(chars[0].characterId);
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

  /**
   * Une page d'historique, tous personnages confondus.
   *
   * L'API ne connaît qu'un personnage à la fois : on interroge les trois en
   * parallèle et on retrie par date, sinon le fil sauterait d'un Gardien à
   * l'autre par paquets de vingt.
   */
  const loadPage = useCallback(
    async (target: number, append: boolean) => {
      if (!defs || characters.length === 0) return;
      setListBusy(true);
      setListError("");
      try {
        const pages = await Promise.all(
          characters.map(async (c) => {
            const data = await fetchHistory(c.characterId, target, 0, PER_PAGE)
              .catch(() => null);
            if (!data) return [];
            return toActivityRows(defs, data, {
              id: c.characterId,
              className: CLASS_NAMES[c.classType] ?? "Gardien",
            });
          })
        );
        const fresh = mergeActivityRows(pages);
        setExhausted(fresh.length === 0);
        setRows((prev) =>
          append ? mergeActivityRows([prev, fresh]) : fresh
        );
      } catch (e) {
        if (!append) setRows([]);
        setListError(e instanceof Error ? e.message : "Historique illisible");
      } finally {
        setListBusy(false);
      }
    },
    [defs, characters]
  );

  useEffect(() => {
    if (tab === "history" && rows.length === 0 && !listBusy) {
      void loadPage(0, false);
    }
    // Le chargement initial ne dépend que de la disponibilité des définitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadPage]);

  useEffect(() => {
    if (tab !== "career" || career || !defs) return;
    let cancelled = false;
    (async () => {
      try {
        const [stats, aggregates] = await Promise.all([
          fetchAccountStats(),
          Promise.all(
            characters.map((c) =>
              fetchAggregate(c.characterId).catch(() => null)
            )
          ),
        ]);
        if (cancelled) return;
        setCareer(toCareerView(stats));
        setAggregate(
          mergeAggregates(
            aggregates
              .filter((a) => a !== null)
              .map((a) => toAggregateRows(defs, a))
          )
        );
      } catch (e) {
        if (cancelled) return;
        setCareer({ highlights: [], domains: [], empty: true });
        setListError(e instanceof Error ? e.message : "Statistiques illisibles");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, career, defs, characters]);

  useEffect(() => {
    if (tab !== "weapons" || !defs || !weaponChar) return;
    let cancelled = false;
    setRecentWeapons(null);
    setExotics(null);
    setWeaponError("");
    (async () => {
      try {
        const [recent, unique] = await Promise.all([
          fetchRecentWeapons(weaponChar, WEAPON_GAMES),
          fetchWeapons(weaponChar).catch(() => null),
        ]);
        if (cancelled) return;
        setRecentWeapons(toRecentWeaponRows(defs, recent));
        setWeaponGames(recent.games);
        setExotics(unique ? toWeaponRows(defs, unique) : []);
      } catch (e) {
        if (cancelled) return;
        setRecentWeapons([]);
        setWeaponError(e instanceof Error ? e.message : "Armes illisibles");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, defs, weaponChar]);

  useEffect(() => {
    if (tab !== "clan" || clan || clanBusy) return;
    let cancelled = false;
    setClanBusy(true);
    setClanError("");
    (async () => {
      try {
        const data = await fetchClanStats();
        if (!cancelled) setClan(data);
      } catch (e) {
        if (!cancelled) {
          setClanError(e instanceof Error ? e.message : "Clan illisible");
        }
      } finally {
        if (!cancelled) setClanBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, clan, clanBusy]);

  async function openReport(instanceId: string) {
    if (!defs) return;
    setReport(null);
    setReportError("");
    setReportBusy(true);
    try {
      const data = await fetchPgcr(instanceId);
      setReport(toPgcrView(defs, data));
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Rapport illisible");
    } finally {
      setReportBusy(false);
    }
  }

  // ---- Filtrage de l'historique ----
  const familyCounts = useMemo(() => {
    const counts = new Map<ActivityFamily, number>();
    for (const row of rows) {
      if (charFilter !== "all" && row.characterId !== charFilter) continue;
      counts.set(row.family, (counts.get(row.family) ?? 0) + 1);
    }
    return counts;
  }, [rows, charFilter]);

  const shownRows = useMemo(
    () =>
      rows.filter((row) => {
        if (charFilter !== "all" && row.characterId !== charFilter) return false;
        return families.size === 0 || families.has(row.family);
      }),
    [rows, families, charFilter]
  );

  const totals = useMemo(() => {
    const kills = shownRows.reduce((a, r) => a + r.kills, 0);
    const deaths = shownRows.reduce((a, r) => a + r.deaths, 0);
    const seconds = shownRows.reduce((a, r) => a + r.durationSeconds, 0);
    return { kills, deaths, seconds };
  }, [shownRows]);

  function toggleFamily(key: ActivityFamily) {
    setFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
        <p className="opacity-70">Connecte-toi pour voir ton historique.</p>
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Activité</h1>
        {tab === "history" && shownRows.length > 0 && (
          <span className="text-sm opacity-60">
            {shownRows.length} parties · {formatPlaytime(totals.seconds)} de jeu ·{" "}
            {totals.kills} éliminations pour {totals.deaths} morts
          </span>
        )}
      </div>

      <div role="tablist" className="tabs tabs-bordered">
        {TABS.map(([value, label, icon]) => (
          <button
            key={value}
            role="tab"
            className={`tab gap-2${tab === value ? " tab-active" : ""}`}
            onClick={() => setTab(value)}
          >
            <RaIcon icon={icon} className="text-base" />
            {label}
          </button>
        ))}
      </div>

      {listError && (
        <div role="alert" className="alert alert-warning text-sm">
          <span>{listError}</span>
        </div>
      )}

      {tab === "history" && (
        <HistoryTab
          rows={shownRows}
          characters={characters}
          charFilter={charFilter}
          onCharFilter={setCharFilter}
          families={families}
          familyCounts={familyCounts}
          onToggleFamily={toggleFamily}
          onClearFamilies={() => setFamilies(new Set())}
          busy={listBusy}
          exhausted={exhausted}
          onMore={() => {
            const next = page + 1;
            setPage(next);
            void loadPage(next, true);
          }}
          onReport={openReport}
        />
      )}

      {tab === "career" && (
        <CareerTab career={career} activities={aggregate} />
      )}

      {tab === "weapons" && (
        <WeaponsTab
          characters={characters}
          selected={weaponChar}
          onSelect={setWeaponChar}
          recent={recentWeapons}
          games={weaponGames}
          exotics={exotics}
          error={weaponError}
        />
      )}

      {tab === "clan" && (
        <ClanTab
          data={clan}
          busy={clanBusy}
          error={clanError}
          sort={clanSort}
          onSort={setClanSort}
        />
      )}

      {(report || reportBusy || reportError) && (
        <ReportModal
          report={report}
          busy={reportBusy}
          error={reportError}
          onClose={() => {
            setReport(null);
            setReportError("");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function HistoryTab({
  rows,
  characters,
  charFilter,
  onCharFilter,
  families,
  familyCounts,
  onToggleFamily,
  onClearFamilies,
  busy,
  exhausted,
  onMore,
  onReport,
}: {
  rows: ActivityRow[];
  characters: Character[];
  charFilter: string;
  onCharFilter: (id: string) => void;
  families: Set<ActivityFamily>;
  familyCounts: Map<ActivityFamily, number>;
  onToggleFamily: (key: ActivityFamily) => void;
  onClearFamilies: () => void;
  busy: boolean;
  exhausted: boolean;
  onMore: () => void;
  onReport: (id: string) => void;
}) {
  // Seules les familles réellement jouées méritent un bouton.
  const available = FAMILIES.filter((f) => (familyCounts.get(f.key) ?? 0) > 0);

  return (
    <>
      <p className="text-sm opacity-60 max-w-3xl">
        Tout ce que tu as joué, dans l&apos;ordre : raids, donjons, nuits noires,
        Creuset, patrouilles et missions se suivent dans un seul fil, sur tous
        tes personnages. Les pictogrammes disent d&apos;un coup d&apos;œil de
        quel type d&apos;activité il s&apos;agit.
      </p>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="join">
          <button
            className={`btn btn-xs join-item${charFilter === "all" ? " btn-primary" : ""}`}
            onClick={() => onCharFilter("all")}
          >
            Tous
          </button>
          {characters.map((c) => (
            <button
              key={c.characterId}
              className={`btn btn-xs join-item${
                charFilter === c.characterId ? " btn-primary" : ""
              }`}
              onClick={() => onCharFilter(c.characterId)}
            >
              {CLASS_NAMES[c.classType] ?? "Gardien"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            className={`btn btn-xs${families.size === 0 ? " btn-primary" : " btn-ghost"}`}
            onClick={onClearFamilies}
          >
            Tout
          </button>
          {available.map((f) => (
            <button
              key={f.key}
              className={`btn btn-xs gap-1.5${
                families.has(f.key) ? " btn-primary" : " btn-ghost"
              }`}
              onClick={() => onToggleFamily(f.key)}
              title={f.label}
            >
              <RaIcon
                icon={f.icon}
                className={families.has(f.key) ? "text-base" : `text-base ${f.color}`}
              />
              {f.label}
              <span className="opacity-60">{familyCounts.get(f.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && !busy ? (
        <div className="opacity-60 py-10 text-center">
          Aucune partie pour ce filtre.
        </div>
      ) : (
        <div className="card bg-base-200 shadow border border-base-300">
          <div className="card-body p-2">
            <div className="flex flex-col divide-y divide-base-300">
              {rows.map((row) => (
                <HistoryRow
                  key={`${row.characterId}-${row.instanceId}`}
                  row={row}
                  onReport={onReport}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-center gap-3 items-center">
        {busy && <span className="loading loading-spinner loading-sm" />}
        {!exhausted && (
          <button className="btn btn-sm btn-outline" disabled={busy} onClick={onMore}>
            Charger des parties plus anciennes
          </button>
        )}
        {exhausted && (
          <span className="text-xs opacity-50">
            Bungie ne garde pas l&apos;historique au-delà de ce point.
          </span>
        )}
      </div>
    </>
  );
}

function HistoryRow({
  row,
  onReport,
}: {
  row: ActivityRow;
  onReport: (id: string) => void;
}) {
  const style = familyStyle(row.family);
  return (
    <div className="flex items-center gap-3 py-2 px-2 hover:bg-base-300/40 rounded">
      <RaIcon
        icon={style.icon}
        className={`text-2xl w-7 text-center shrink-0 ${style.color}`}
        title={style.label}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{row.name}</div>
        <div className="text-xs opacity-60 flex gap-1.5 flex-wrap">
          <span>{row.mode || style.label}</span>
          <span>· {row.className}</span>
          <span>· {row.when}</span>
          {row.standing === 0 && <span className="text-success">· victoire</span>}
          {row.standing === 1 && <span className="text-error">· défaite</span>}
          {row.standing === undefined && !row.completed && (
            <span className="text-warning">· abandonnée</span>
          )}
        </div>
      </div>
      <div className="text-right text-xs font-mono shrink-0 hidden sm:block">
        <div>{row.duration}</div>
        <div className="opacity-60">
          {row.kills} / {row.deaths} / {row.assists}
        </div>
      </div>
      <button
        className="btn btn-xs btn-ghost shrink-0"
        onClick={() => onReport(row.instanceId)}
      >
        Rapport
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carrière
// ---------------------------------------------------------------------------

function CareerTab({
  career,
  activities,
}: {
  career: CareerView | null;
  activities: AggregateRow[] | null;
}) {
  if (!career) {
    return (
      <div className="flex justify-center py-10">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (career.empty) {
    return (
      <div className="opacity-60 py-10 text-center">
        Bungie ne renvoie aucune statistique pour ce compte.
      </div>
    );
  }

  const top = (activities ?? []).slice(0, 12);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm opacity-60 max-w-3xl">
        Le cumul de tout ce que tu as joué depuis la création du compte, tous
        personnages confondus — y compris ceux que tu as supprimés. Chaque
        nombre porte la phrase qui dit ce qu&apos;il compte.
      </p>

      <div className="flex flex-wrap gap-3">
        {career.highlights.map((stat) => (
          <div
            key={stat.label}
            className="card bg-base-200 border border-base-300 shadow grow shrink basis-64 max-w-md"
          >
            <div className="card-body p-4 gap-1">
              <div className="text-xs uppercase tracking-wider opacity-50">
                {stat.label}
              </div>
              <div className="text-3xl font-semibold text-primary leading-none">
                {stat.value}
              </div>
              <p className="text-xs opacity-60 mt-1">{stat.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 items-stretch">
        {career.domains.map((domain) => (
          <div
            key={domain.key}
            className="card bg-base-200 border border-base-300 shadow grow shrink basis-80 max-w-xl"
          >
            <div className="card-body p-4 gap-3">
              <div className="flex items-center gap-2.5">
                <RaIcon icon={domain.icon} className="text-2xl text-primary" />
                <div>
                  <h2 className="font-semibold">{domain.label}</h2>
                  <p className="text-xs opacity-60">{domain.subtitle}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {domain.stats.map((stat) => (
                  <div key={stat.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm opacity-80">{stat.label}</span>
                      <span
                        className={`font-mono ${
                          stat.strong ? "text-lg text-primary" : "text-sm"
                        }`}
                      >
                        {stat.value}
                      </span>
                    </div>
                    <p className="text-xs opacity-50">{stat.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <RaIcon icon={ICONS.activity} className="text-primary" />
            Les activités que tu joues le plus
          </h2>
          <p className="text-sm opacity-60 max-w-3xl">
            Comptées sur tes personnages actuels. «&nbsp;Record&nbsp;» est ta
            complétion la plus rapide sur cette activité.
          </p>
          <div className="card bg-base-200 shadow border border-base-300">
            <div className="card-body p-2">
              <div className="overflow-x-auto">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Activité</th>
                      <th className="text-right">Terminée</th>
                      <th className="text-right">É / M</th>
                      <th className="text-right">Temps passé</th>
                      <th className="text-right">Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((row) => (
                      <tr key={row.activityHash}>
                        <td>
                          <div className="font-medium">{row.name}</div>
                          {row.mode && (
                            <div className="text-xs opacity-60">{row.mode}</div>
                          )}
                        </td>
                        <td className="text-right font-mono">
                          {row.completions} fois
                        </td>
                        <td className="text-right font-mono">
                          {row.kills} / {row.deaths}
                        </td>
                        <td className="text-right font-mono">
                          {formatPlaytime(row.playtimeSeconds)}
                        </td>
                        <td className="text-right font-mono">
                          {row.fastestSeconds > 0
                            ? formatDuration(row.fastestSeconds)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Armes
// ---------------------------------------------------------------------------

function WeaponsTab({
  characters,
  selected,
  onSelect,
  recent,
  games,
  exotics,
  error,
}: {
  characters: Character[];
  selected: string;
  onSelect: (id: string) => void;
  recent: RecentWeaponRow[] | null;
  games: number;
  exotics: WeaponRow[] | null;
  error: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="join">
          {characters.map((c) => (
            <button
              key={c.characterId}
              className={`btn btn-xs join-item${
                selected === c.characterId ? " btn-primary" : ""
              }`}
              onClick={() => onSelect(c.characterId)}
            >
              {CLASS_NAMES[c.classType] ?? "Gardien"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-warning text-sm">
          <span>{error}</span>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <RaIcon icon={ICONS.weapon} className="text-primary" />
          Ce avec quoi tu joues vraiment
        </h2>
        <p className="text-sm opacity-60 max-w-3xl">
          Reconstitué en relisant tes {games || WEAPON_GAMES} dernières parties,
          arme par arme. C&apos;est la seule façon de voir autre chose que les
          exotiques : Bungie ne tient de compteur permanent que pour ceux-là.
        </p>

        {recent === null ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : recent.length === 0 ? (
          <div className="opacity-60 py-8 text-center">
            Aucune élimination dans les parties relues.
          </div>
        ) : (
          <div className="card bg-base-200 shadow border border-base-300">
            <div className="card-body p-2">
              <div className="overflow-x-auto">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Arme</th>
                      <th>Type</th>
                      <th className="text-right">Éliminations</th>
                      <th className="text-right">Par partie</th>
                      <th className="text-right">Précision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((weapon) => (
                      <WeaponRowView key={weapon.itemHash} weapon={weapon} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <RaIcon icon="ra-alien-fire" className="text-[#ceae33]" />
          Exotiques, depuis toujours
        </h2>
        <p className="text-sm opacity-60 max-w-3xl">
          Le compteur à vie de Bungie. Il ne couvre que les armes exotiques,
          d&apos;où la liste courte.
        </p>
        {exotics === null ? (
          <div className="flex justify-center py-6">
            <span className="loading loading-spinner text-primary" />
          </div>
        ) : exotics.length === 0 ? (
          <div className="opacity-60 py-6 text-center text-sm">
            Aucune élimination exotique enregistrée sur ce personnage.
          </div>
        ) : (
          <div className="card bg-base-200 shadow border border-base-300">
            <div className="card-body p-2">
              <div className="overflow-x-auto">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Arme</th>
                      <th>Type</th>
                      <th className="text-right">Éliminations</th>
                      <th className="text-right">Précision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exotics.map((weapon) => (
                      <tr key={weapon.itemHash}>
                        <td>
                          <WeaponName weapon={weapon} />
                        </td>
                        <td className="text-xs opacity-60 uppercase">
                          {weapon.typeName}
                        </td>
                        <td className="text-right font-mono">{weapon.kills}</td>
                        <td className="text-right font-mono">
                          {weapon.precisionRatio}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function WeaponName({ weapon }: { weapon: WeaponRow }) {
  return (
    <div className="flex items-center gap-3">
      {weapon.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="item-icon !w-10 !h-10"
          src={`${BUNGIE_ROOT}${weapon.icon}`}
          alt=""
        />
      ) : (
        <div className="item-icon !w-10 !h-10" />
      )}
      <span className="font-medium">{weapon.name}</span>
    </div>
  );
}

function WeaponRowView({ weapon }: { weapon: RecentWeaponRow }) {
  return (
    <tr>
      <td>
        <WeaponName weapon={weapon} />
      </td>
      <td className="text-xs opacity-60 uppercase">{weapon.typeName}</td>
      <td className="text-right font-mono">{weapon.kills}</td>
      <td className="text-right font-mono">{weapon.killsPerGame}</td>
      <td className="text-right font-mono">{weapon.precisionRatio}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Clan
// ---------------------------------------------------------------------------

type ClanSortKey =
  | "secondsPlayed"
  | "activitiesCleared"
  | "kills"
  | "killsDeathsRatio"
  | "pvpWins"
  | "raidClears";

const CLAN_COLUMNS: {
  key: ClanSortKey;
  label: string;
  hint: string;
  format: (m: ClanMemberStats) => string;
}[] = [
  {
    key: "secondsPlayed",
    label: "Temps de jeu",
    hint: "Manette en main, PvE et Creuset confondus.",
    format: (m) => formatPlaytime(m.secondsPlayed),
  },
  {
    key: "activitiesCleared",
    label: "Activités terminées",
    hint: "Menées jusqu'à l'écran de fin.",
    format: (m) => m.activitiesCleared.toLocaleString("fr-FR"),
  },
  {
    key: "kills",
    label: "Éliminations",
    hint: "Toutes activités confondues.",
    format: (m) => m.kills.toLocaleString("fr-FR"),
  },
  {
    key: "killsDeathsRatio",
    label: "K/D au Creuset",
    hint: "Éliminations par mort, en joueur contre joueur.",
    format: (m) => m.killsDeathsRatio.toFixed(2),
  },
  {
    key: "pvpWins",
    label: "Victoires PvP",
    hint: "Parties gagnées au Creuset.",
    format: (m) => m.pvpWins.toLocaleString("fr-FR"),
  },
  {
    key: "raidClears",
    label: "Raids terminés",
    hint: "Complétions de raid, toutes destinations confondues.",
    format: (m) => m.raidClears.toLocaleString("fr-FR"),
  },
];

function ClanTab({
  data,
  busy,
  error,
  sort,
  onSort,
}: {
  data: { clanName: string | null; members: ClanMemberStats[] } | null;
  busy: boolean;
  error: string;
  sort: ClanSortKey;
  onSort: (key: ClanSortKey) => void;
}) {
  const ranked = useMemo(() => {
    if (!data) return [];
    const known = data.members.filter((m) => !m.private);
    const hidden = data.members.filter((m) => m.private);
    known.sort((a, b) => (b[sort] as number) - (a[sort] as number));
    return [...known, ...hidden];
  }, [data, sort]);

  const me = ranked.findIndex((m) => m.isMe);
  const column = CLAN_COLUMNS.find((c) => c.key === sort) ?? CLAN_COLUMNS[0];

  if (busy) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 opacity-70">
        <span className="loading loading-spinner loading-lg text-primary" />
        <div className="text-sm">
          Lecture des statistiques de chaque membre du clan…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="alert alert-warning text-sm">
        <span>{error}</span>
      </div>
    );
  }
  if (!data || data.members.length === 0) {
    return (
      <div className="opacity-60 py-10 text-center">
        Tu n&apos;appartiens à aucun clan, ou Bungie n&apos;en renvoie pas le
        roster.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <RaIcon icon={ICONS.clan} className="text-primary" />
          {data.clanName ?? "Ton clan"}
        </h2>
        {me >= 0 && (
          <span className="badge badge-primary">
            Tu es {me + 1}<sup>{me === 0 ? "er" : "e"}</sup> sur{" "}
            {ranked.filter((m) => !m.private).length} · {column.label}
          </span>
        )}
      </div>

      <p className="text-sm opacity-60 max-w-3xl">{column.hint}</p>

      <div className="flex flex-wrap gap-1.5">
        {CLAN_COLUMNS.map((c) => (
          <button
            key={c.key}
            className={`btn btn-xs${sort === c.key ? " btn-primary" : " btn-ghost"}`}
            onClick={() => onSort(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="card bg-base-200 shadow border border-base-300">
        <div className="card-body p-2">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Gardien</th>
                  <th className="text-right">{column.label}</th>
                  <th className="text-right hidden md:table-cell">
                    Activités terminées
                  </th>
                  <th className="text-right hidden lg:table-cell">Raids</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((member, index) => (
                  <tr
                    key={`${member.membershipType}-${member.membershipId}`}
                    className={
                      member.isMe
                        ? "bg-primary/15 font-medium"
                        : member.private
                          ? "opacity-40"
                          : ""
                    }
                  >
                    <td className="font-mono opacity-60">
                      {member.private ? "—" : index + 1}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {member.isOnline && (
                          <span
                            className="w-2 h-2 rounded-full bg-success"
                            title="En ligne"
                          />
                        )}
                        <span>{member.name}</span>
                        {member.code !== undefined && (
                          <span className="opacity-40 text-xs">
                            #{String(member.code).padStart(4, "0")}
                          </span>
                        )}
                        {member.private && (
                          <span className="badge badge-ghost badge-xs">
                            profil privé
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right font-mono">
                      {member.private ? "—" : column.format(member)}
                    </td>
                    <td className="text-right font-mono hidden md:table-cell">
                      {member.private
                        ? "—"
                        : member.activitiesCleared.toLocaleString("fr-FR")}
                    </td>
                    <td className="text-right font-mono hidden lg:table-cell">
                      {member.private ? "—" : member.raidClears}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs opacity-50 max-w-3xl">
        Un membre qui a restreint son profil sur Bungie.net n&apos;expose aucun
        compteur : il apparaît en bas de liste plutôt qu&apos;avec un zéro, qui
        serait faux.
      </p>
    </div>
  );
}

/**
 * Additionne les activités cumulées de plusieurs personnages.
 * Un raid terminé deux fois sur deux Gardiens compte pour deux.
 */
function mergeAggregates(lists: AggregateRow[][]): AggregateRow[] {
  const merged = new Map<number, AggregateRow>();
  for (const row of lists.flat()) {
    const current = merged.get(row.activityHash);
    if (!current) {
      merged.set(row.activityHash, { ...row });
      continue;
    }
    current.completions += row.completions;
    current.kills += row.kills;
    current.deaths += row.deaths;
    current.playtimeSeconds += row.playtimeSeconds;
    // Le record est le meilleur des personnages, pas celui du premier lu.
    if (
      row.fastestSeconds > 0 &&
      (current.fastestSeconds === 0 || row.fastestSeconds < current.fastestSeconds)
    ) {
      current.fastestSeconds = row.fastestSeconds;
    }
  }
  return [...merged.values()].sort((a, b) => b.completions - a.completions);
}

// ---------------------------------------------------------------------------
// Rapport de fin de partie
// ---------------------------------------------------------------------------

function ReportModal({
  report,
  busy,
  error,
  onClose,
}: {
  report: PgcrView | null;
  busy: boolean;
  error: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal modal-open" role="dialog">
      <div className="modal-box max-w-4xl">
        {busy && (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}
        {report && (
          <>
            <h3 className="text-lg font-semibold">{report.name}</h3>
            <div className="text-xs opacity-60 mb-3">
              {report.mode} · {new Date(report.date).toLocaleString("fr-FR")} ·{" "}
              {report.duration}
            </div>

            {report.teams.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3">
                {report.teams.map((team) => (
                  <span
                    key={team.name}
                    className={`badge ${team.won ? "badge-success" : "badge-ghost"}`}
                  >
                    {team.name} · {team.score}
                  </span>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Joueur</th>
                    <th>Classe</th>
                    <th className="text-right">✦</th>
                    <th className="text-right">É / M / A</th>
                    <th className="text-right">K/D</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">Temps</th>
                  </tr>
                </thead>
                <tbody>
                  {report.players.map((player) => (
                    <tr key={`${player.characterId}-${player.membershipId}`}>
                      <td>
                        <span className="font-medium">{player.name}</span>
                        {player.code !== undefined && (
                          <span className="opacity-50 text-xs">
                            #{String(player.code).padStart(4, "0")}
                          </span>
                        )}
                        {player.clanTag && (
                          <span className="badge badge-ghost badge-xs ml-2">
                            {player.clanTag}
                          </span>
                        )}
                      </td>
                      <td className="text-xs opacity-70">{player.className}</td>
                      <td className="text-right font-mono">{player.light}</td>
                      <td className="text-right font-mono">
                        {player.kills} / {player.deaths} / {player.assists}
                      </td>
                      <td className="text-right font-mono">{player.kd}</td>
                      <td className="text-right font-mono">{player.score}</td>
                      <td className="text-right font-mono">{player.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="modal-action">
          <button className="btn btn-sm" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-black/60" onClick={onClose} />
    </div>
  );
}
