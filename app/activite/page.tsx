"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import { BUNGIE_ROOT, CLASS_NAMES } from "@/lib/destiny-constants";
import {
  fetchAccountStats,
  fetchAggregate,
  fetchHistory,
  fetchPgcr,
  fetchWeapons,
  toActivityRows,
  toAggregateRows,
  toCareerGroups,
  toPgcrView,
  toWeaponRows,
  type ActivityRow,
  type AggregateRow,
  type CareerGroup,
  type PgcrView,
  type WeaponRow,
} from "@/lib/activity-client";
import type { Character, Defs, ProfileResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";
type Tab = "history" | "career" | "weapons" | "activities";

/** DestinyActivityModeType — les modes qui valent un filtre. */
const MODES: { value: number; label: string }[] = [
  { value: 0, label: "Tout" },
  { value: 7, label: "PvE" },
  { value: 4, label: "Raids" },
  { value: 82, label: "Donjons" },
  { value: 18, label: "Assauts" },
  { value: 46, label: "Nuits noires" },
  { value: 5, label: "Creuset" },
  { value: 84, label: "Épreuves" },
  { value: 63, label: "Gambit" },
];

export default function ActivityPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedChar, setSelectedChar] = useState("");
  const [tab, setTab] = useState<Tab>("history");

  const [mode, setMode] = useState(0);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");

  const [career, setCareer] = useState<CareerGroup[] | null>(null);
  const [weapons, setWeapons] = useState<WeaponRow[] | null>(null);
  const [aggregate, setAggregate] = useState<AggregateRow[] | null>(null);

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

  // Changer de personnage ou de mode repart de la première page.
  useEffect(() => {
    setPage(0);
  }, [selectedChar, mode]);

  // Les onglets « carrière », « armes » et « activités » sont propres à un
  // personnage (sauf la carrière, qui vaut pour le compte) : on repart de zéro.
  useEffect(() => {
    setWeapons(null);
    setAggregate(null);
  }, [selectedChar]);

  const loadHistory = useCallback(async () => {
    if (!defs || !selectedChar) return;
    setListBusy(true);
    setListError("");
    try {
      const data = await fetchHistory(selectedChar, page, mode);
      setRows(toActivityRows(defs, data));
    } catch (e) {
      setRows([]);
      setListError(e instanceof Error ? e.message : "Historique illisible");
    } finally {
      setListBusy(false);
    }
  }, [defs, selectedChar, page, mode]);

  useEffect(() => {
    if (tab === "history") void loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    if (tab !== "career" || career || !defs) return;
    let cancelled = false;
    (async () => {
      try {
        const stats = await fetchAccountStats();
        if (!cancelled) setCareer(toCareerGroups(stats));
      } catch (e) {
        if (!cancelled) {
          setCareer([]);
          setListError(e instanceof Error ? e.message : "Statistiques illisibles");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, career, defs]);

  useEffect(() => {
    if (tab !== "weapons" || weapons || !defs || !selectedChar) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchWeapons(selectedChar);
        if (!cancelled) setWeapons(toWeaponRows(defs, data));
      } catch (e) {
        if (!cancelled) {
          setWeapons([]);
          setListError(e instanceof Error ? e.message : "Armes illisibles");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, weapons, defs, selectedChar]);

  useEffect(() => {
    if (tab !== "activities" || aggregate || !defs || !selectedChar) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAggregate(selectedChar);
        if (!cancelled) setAggregate(toAggregateRows(defs, data));
      } catch (e) {
        if (!cancelled) {
          setAggregate([]);
          setListError(e instanceof Error ? e.message : "Activités illisibles");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, aggregate, defs, selectedChar]);

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

  const totals = useMemo(() => {
    const kills = rows.reduce((a, r) => a + r.kills, 0);
    const deaths = rows.reduce((a, r) => a + r.deaths, 0);
    return { kills, deaths };
  }, [rows]);

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
        {tab === "history" && rows.length > 0 && (
          <span className="badge badge-ghost">
            {rows.length} parties · {totals.kills} élims / {totals.deaths} morts
          </span>
        )}
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

      <div role="tablist" className="tabs tabs-bordered">
        {(
          [
            ["history", "Historique"],
            ["career", "Carrière"],
            ["weapons", "Armes"],
            ["activities", "Activités"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            className={`tab${tab === value ? " tab-active" : ""}`}
            onClick={() => setTab(value)}
          >
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
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <select
              className="select select-sm select-bordered"
              value={mode}
              onChange={(e) => setMode(Number(e.target.value))}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="join">
              <button
                className="btn btn-sm join-item"
                disabled={page === 0 || listBusy}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ←
              </button>
              <span className="btn btn-sm join-item no-animation pointer-events-none">
                Page {page + 1}
              </span>
              <button
                className="btn btn-sm join-item"
                disabled={rows.length < 25 || listBusy}
                onClick={() => setPage((p) => p + 1)}
              >
                →
              </button>
            </div>
            {listBusy && <span className="loading loading-spinner loading-sm" />}
          </div>

          {rows.length === 0 && !listBusy ? (
            <div className="opacity-60 py-10 text-center">
              Aucune partie pour ce filtre.
            </div>
          ) : (
            <div className="card bg-base-200 shadow">
              <div className="card-body p-2">
                <div className="overflow-x-auto">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr>
                        <th>Activité</th>
                        <th>Quand</th>
                        <th className="text-right">Durée</th>
                        <th className="text-right">É / M / A</th>
                        <th className="text-right">K/D</th>
                        <th className="text-right">Détail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.instanceId}>
                          <td>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs opacity-60 flex gap-1.5 flex-wrap">
                              <span>{row.mode}</span>
                              {row.standing === 0 && (
                                <span className="text-success">victoire</span>
                              )}
                              {row.standing === 1 && (
                                <span className="text-error">défaite</span>
                              )}
                              {row.standing === undefined && !row.completed && (
                                <span className="text-warning">abandonnée</span>
                              )}
                            </div>
                          </td>
                          <td className="text-xs opacity-70">{row.when}</td>
                          <td className="text-right font-mono">{row.duration}</td>
                          <td className="text-right font-mono">
                            {row.kills} / {row.deaths} / {row.assists}
                          </td>
                          <td className="text-right font-mono">{row.kd}</td>
                          <td className="text-right">
                            <button
                              className="btn btn-xs btn-outline btn-primary"
                              onClick={() => openReport(row.instanceId)}
                            >
                              Rapport
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "career" &&
        (career === null ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : career.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Bungie ne renvoie aucune statistique pour ce compte.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {career.map((group) => (
              <div
                key={group.key}
                className="card bg-base-200 shadow border border-base-300"
              >
                <div className="card-body p-4">
                  <h2 className="card-title text-base">{group.label}</h2>
                  <table className="table table-sm">
                    <tbody>
                      {group.stats.map((stat) => (
                        <tr key={stat.label}>
                          <td className="opacity-70">{stat.label}</td>
                          <td className="text-right font-mono">{stat.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === "weapons" &&
        (weapons === null ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : weapons.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Aucune élimination enregistrée pour ce personnage.
          </div>
        ) : (
          <div className="card bg-base-200 shadow">
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
                    {weapons.map((weapon) => (
                      <tr key={weapon.itemHash}>
                        <td>
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
        ))}

      {tab === "activities" &&
        (aggregate === null ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : aggregate.length === 0 ? (
          <div className="opacity-60 py-10 text-center">
            Aucune activité terminée avec ce personnage.
          </div>
        ) : (
          <div className="card bg-base-200 shadow">
            <div className="card-body p-2">
              <div className="overflow-x-auto">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Activité</th>
                      <th className="text-right">Complétions</th>
                      <th className="text-right">É / M</th>
                      <th className="text-right">Temps</th>
                      <th className="text-right">Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregate.map((row) => (
                      <tr key={row.activityHash}>
                        <td>
                          <div className="font-medium">{row.name}</div>
                          {row.mode && (
                            <div className="text-xs opacity-60">{row.mode}</div>
                          )}
                        </td>
                        <td className="text-right font-mono">{row.completions}</td>
                        <td className="text-right font-mono">
                          {row.kills} / {row.deaths}
                        </td>
                        <td className="text-right font-mono">{row.playtime}</td>
                        <td className="text-right font-mono">{row.fastest}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}

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

      <p className="text-xs opacity-50">
        L&apos;historique vient de <code>GetActivityHistory</code> et le détail
        d&apos;une partie de <code>GetPostGameCarnageReport</code> : ce sont les
        mêmes données que les sites de statistiques, lues directement sur ton
        compte.
      </p>
    </div>
  );
}

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
