import type {
  AccountHistoricalStats,
  ActivityHistoryEntry,
  ActivityHistoryPage,
  AggregateActivityResults,
  Defs,
  PostGameCarnageReport,
  StatsValue,
  UniqueWeaponResults,
} from "./types";

/**
 * Lecture de l'historique de jeu (endpoints `Stats/*`).
 *
 * Ces réponses sont un sac de compteurs génériques : chaque valeur arrive sous
 * la forme `{ basic: { value, displayValue } }`, sans typage utile. Ce module
 * les transforme en lignes prêtes à afficher — et il est le seul endroit du
 * site à connaître les noms de compteurs Bungie.
 */

type Kind = "history" | "pgcr" | "stats" | "weapons" | "aggregate";

async function get<T>(kind: Kind, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ kind, ...params });
  const res = await fetch(`/api/bungie/activity?${query}`);
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

export const fetchHistory = (characterId: string, page: number, mode: number) =>
  get<ActivityHistoryPage>("history", {
    characterId,
    page: String(page),
    mode: String(mode),
    count: "25",
  });

export const fetchPgcr = (activityId: string) =>
  get<PostGameCarnageReport>("pgcr", { activityId });

export const fetchAccountStats = () => get<AccountHistoricalStats>("stats");

export const fetchWeapons = (characterId: string) =>
  get<UniqueWeaponResults>("weapons", { characterId });

export const fetchAggregate = (characterId: string) =>
  get<AggregateActivityResults>("aggregate", { characterId });

// ---------------------------------------------------------------------------
// Lecture des compteurs
// ---------------------------------------------------------------------------

function num(values: Record<string, StatsValue> | undefined, key: string): number {
  return values?.[key]?.basic?.value ?? 0;
}

function text(
  values: Record<string, StatsValue> | undefined,
  key: string
): string | null {
  const entry = values?.[key]?.basic;
  if (!entry) return null;
  return entry.displayValue ?? (entry.value !== undefined ? String(entry.value) : null);
}

/** « 32 min », « 1 h 04 ». */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")}`;
  return `${minutes} min`;
}

/** « il y a 2 h », « hier », « le 12/03 ». */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms)) return "—";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `il y a ${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} j`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/**
 * Nom du mode de jeu.
 *
 * L'historique donne un `modeType` numérique, alors que le manifest indexe les
 * modes par hash : on construit donc l'index inverse une fois pour toutes.
 */
let modeIndex: Map<number, string> | null = null;
let modeIndexSource: Defs | null = null;

function modeName(defs: Defs, modeType: number | undefined): string {
  if (!modeType) return "";
  if (!modeIndex || modeIndexSource !== defs) {
    modeIndex = new Map();
    for (const def of Object.values(defs.activityModes ?? {})) {
      if (def.modeType !== undefined) {
        modeIndex.set(def.modeType, def.displayProperties?.name ?? "");
      }
    }
    modeIndexSource = defs;
  }
  return modeIndex.get(modeType) ?? "";
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export interface ActivityRow {
  instanceId: string;
  when: string;
  date: string;
  name: string;
  mode: string;
  image?: string;
  duration: string;
  completed: boolean;
  /** 0 victoire, 1 défaite, undefined hors PvP */
  standing?: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: string;
}

function activityRow(defs: Defs, entry: ActivityHistoryEntry): ActivityRow {
  const def = defs.activities?.[entry.activityDetails.directorActivityHash];
  const standingRaw = entry.values?.standing?.basic?.value;
  return {
    instanceId: entry.activityDetails.instanceId,
    when: formatWhen(entry.period),
    date: entry.period,
    name: def?.displayProperties?.name || "Activité inconnue",
    mode: modeName(defs, entry.activityDetails.mode),
    image: def?.pgcrImage,
    duration: formatDuration(num(entry.values, "activityDurationSeconds")),
    completed: num(entry.values, "completed") > 0,
    standing: standingRaw === undefined || standingRaw < 0 ? undefined : standingRaw,
    kills: num(entry.values, "kills"),
    deaths: num(entry.values, "deaths"),
    assists: num(entry.values, "assists"),
    kd: text(entry.values, "killsDeathsRatio") ?? "—",
  };
}

export function toActivityRows(
  defs: Defs,
  page: ActivityHistoryPage
): ActivityRow[] {
  return (page.activities ?? []).map((entry) => activityRow(defs, entry));
}

// ---------------------------------------------------------------------------
// Rapport de fin de partie
// ---------------------------------------------------------------------------

export interface PgcrPlayer {
  characterId: string;
  name: string;
  code?: number;
  membershipType: number;
  membershipId: string;
  className: string;
  light: number;
  clanTag?: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: string;
  score: number;
  duration: string;
  completed: boolean;
  standing?: number;
}

export interface PgcrView {
  name: string;
  mode: string;
  image?: string;
  date: string;
  duration: string;
  teams: { name: string; score: number; won: boolean }[];
  players: PgcrPlayer[];
}

export function toPgcrView(defs: Defs, report: PostGameCarnageReport): PgcrView {
  const def = defs.activities?.[report.activityDetails.directorActivityHash];
  const entries = report.entries ?? [];

  const players: PgcrPlayer[] = entries.map((entry) => {
    const info = entry.player.destinyUserInfo;
    const standing = entry.standing;
    return {
      characterId: entry.characterId,
      name:
        info.bungieGlobalDisplayName || info.displayName || "Gardien",
      code: info.bungieGlobalDisplayNameCode,
      membershipType: info.membershipType,
      membershipId: info.membershipId,
      className:
        entry.player.characterClass ||
        (entry.player.classHash !== undefined
          ? (defs.classes?.[entry.player.classHash]?.displayProperties?.name ?? "")
          : ""),
      light: entry.player.lightLevel ?? 0,
      clanTag: entry.player.clanTag,
      kills: num(entry.values, "kills"),
      deaths: num(entry.values, "deaths"),
      assists: num(entry.values, "assists"),
      kd: text(entry.values, "killsDeathsRatio") ?? "—",
      score: num(entry.values, "score"),
      duration: formatDuration(num(entry.values, "timePlayedSeconds")),
      completed: num(entry.values, "completed") > 0,
      standing: standing === undefined || standing < 0 ? undefined : standing,
    };
  });

  // Les meilleurs d'abord : c'est ce qu'on cherche en ouvrant un rapport.
  players.sort((a, b) => b.score - a.score || b.kills - a.kills);

  const teams = (report.teams ?? []).map((team) => ({
    name: team.teamName || `Équipe ${team.teamId}`,
    score: team.score?.basic?.value ?? 0,
    won: (team.standing?.basic?.value ?? -1) === 0,
  }));

  const longest = entries.reduce(
    (max, e) => Math.max(max, num(e.values, "activityDurationSeconds")),
    0
  );

  return {
    name: def?.displayProperties?.name || "Activité inconnue",
    mode: modeName(defs, report.activityDetails.mode),
    image: def?.pgcrImage,
    date: report.period,
    duration: formatDuration(longest),
    teams,
    players,
  };
}

// ---------------------------------------------------------------------------
// Armes et activités cumulées
// ---------------------------------------------------------------------------

export interface WeaponRow {
  itemHash: number;
  name: string;
  icon?: string;
  typeName: string;
  kills: number;
  precisionKills: number;
  precisionRatio: string;
}

export function toWeaponRows(
  defs: Defs,
  results: UniqueWeaponResults
): WeaponRow[] {
  const rows: WeaponRow[] = [];
  for (const weapon of results.weapons ?? []) {
    const def = defs.items?.[weapon.referenceId];
    const kills = num(weapon.values, "uniqueWeaponKills");
    if (kills <= 0) continue;
    const precision = num(weapon.values, "uniqueWeaponPrecisionKills");
    rows.push({
      itemHash: weapon.referenceId,
      name: def?.displayProperties?.name ?? `Arme ${weapon.referenceId}`,
      icon: def?.displayProperties?.icon,
      typeName: def?.itemTypeDisplayName ?? "",
      kills,
      precisionKills: precision,
      precisionRatio:
        kills > 0 ? `${Math.round((precision / kills) * 100)} %` : "—",
    });
  }
  rows.sort((a, b) => b.kills - a.kills);
  return rows;
}

export interface AggregateRow {
  activityHash: number;
  name: string;
  mode: string;
  image?: string;
  completions: number;
  kills: number;
  deaths: number;
  playtime: string;
  fastest: string;
}

export function toAggregateRows(
  defs: Defs,
  results: AggregateActivityResults
): AggregateRow[] {
  const rows: AggregateRow[] = [];
  for (const activity of results.activities ?? []) {
    const def = defs.activities?.[activity.activityHash];
    const completions = num(activity.values, "activityCompletions");
    if (completions <= 0) continue;
    const fastestMs = num(activity.values, "fastestCompletionMsForActivity");
    rows.push({
      activityHash: activity.activityHash,
      name: def?.displayProperties?.name ?? `Activité ${activity.activityHash}`,
      mode: def?.activityModeHashes?.length
        ? (defs.activityModes?.[def.activityModeHashes[0]]?.displayProperties
            ?.name ?? "")
        : "",
      image: def?.pgcrImage,
      completions,
      kills: num(activity.values, "activityKills"),
      deaths: num(activity.values, "activityDeaths"),
      playtime: formatDuration(num(activity.values, "activitySecondsPlayed")),
      fastest: fastestMs > 0 ? formatDuration(Math.round(fastestMs / 1000)) : "—",
    });
  }
  rows.sort((a, b) => b.completions - a.completions);
  return rows;
}

// ---------------------------------------------------------------------------
// Carrière
// ---------------------------------------------------------------------------

/** Libellés des groupes renvoyés par Bungie (la liste dépend des modes joués). */
const GROUP_LABELS: Record<string, string> = {
  allPvE: "PvE",
  allPvP: "Creuset",
  allPvECompetitive: "Gambit",
  allStrikes: "Assauts",
  raid: "Raids",
  patrol: "Patrouille",
  story: "Histoire",
};

const CAREER_FIELDS: { key: string; label: string }[] = [
  { key: "activitiesEntered", label: "Activités jouées" },
  { key: "activitiesCleared", label: "Activités terminées" },
  { key: "activitiesWon", label: "Victoires" },
  { key: "kills", label: "Éliminations" },
  { key: "deaths", label: "Morts" },
  { key: "assists", label: "Assistances" },
  { key: "killsDeathsRatio", label: "K/D" },
  { key: "efficiency", label: "Efficacité" },
  { key: "precisionKills", label: "Éliminations de précision" },
  { key: "bestSingleGameKills", label: "Meilleur score d'élims" },
  { key: "longestKillSpree", label: "Meilleure série" },
  { key: "secondsPlayed", label: "Temps de jeu" },
];

export interface CareerGroup {
  key: string;
  label: string;
  stats: { label: string; value: string }[];
}

export function toCareerGroups(stats: AccountHistoricalStats): CareerGroup[] {
  const groups: CareerGroup[] = [];
  for (const [key, group] of Object.entries(
    stats.mergedAllCharacters?.results ?? {}
  )) {
    const values = group.allTime;
    if (!values) continue;

    const rows: { label: string; value: string }[] = [];
    for (const field of CAREER_FIELDS) {
      const entry = values[field.key]?.basic;
      if (!entry) continue;
      const value =
        field.key === "secondsPlayed"
          ? formatDuration(entry.value ?? 0)
          : (entry.displayValue ??
            (entry.value !== undefined ? String(Math.round(entry.value)) : ""));
      if (value) rows.push({ label: field.label, value });
    }
    if (rows.length === 0) continue;

    groups.push({ key, label: GROUP_LABELS[key] ?? key, stats: rows });
  }

  // Les groupes connus d'abord, dans l'ordre du dictionnaire.
  const order = Object.keys(GROUP_LABELS);
  groups.sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return groups;
}
