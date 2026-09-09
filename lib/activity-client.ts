import { activityFamily, ICONS, type ActivityFamily } from "./rpg-icons";
import { formatNumber } from "./weekly-engine";
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

export const fetchHistory = (
  characterId: string,
  page: number,
  mode: number,
  count = 25
) =>
  get<ActivityHistoryPage>("history", {
    characterId,
    page: String(page),
    mode: String(mode),
    count: String(count),
  });

export const fetchPgcr = (activityId: string) =>
  get<PostGameCarnageReport>("pgcr", { activityId });

export const fetchAccountStats = () => get<AccountHistoricalStats>("stats");

export const fetchWeapons = (characterId: string) =>
  get<UniqueWeaponResults>("weapons", { characterId });

export const fetchAggregate = (characterId: string) =>
  get<AggregateActivityResults>("aggregate", { characterId });

/** Réponse de /api/bungie/weapons : toutes les armes des dernières parties. */
export interface RecentWeaponsPayload {
  weapons: {
    itemHash: number;
    kills: number;
    precisionKills: number;
    games: number;
  }[];
  games: number;
  since?: string;
  error?: string;
}

export async function fetchRecentWeapons(
  characterId: string,
  count = 25
): Promise<RecentWeaponsPayload> {
  const res = await fetch(
    `/api/bungie/weapons?characterId=${characterId}&count=${count}`
  );
  const json = (await res.json().catch(() => null)) as RecentWeaponsPayload | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

export interface ClanMemberStats {
  membershipId: string;
  membershipType: number;
  name: string;
  code?: number;
  icon?: string;
  isOnline: boolean;
  private: boolean;
  isMe: boolean;
  secondsPlayed: number;
  activitiesCleared: number;
  kills: number;
  deaths: number;
  killsDeathsRatio: number;
  efficiency: number;
  pvpKills: number;
  pvpWins: number;
  raidClears: number;
}

export interface ClanStatsPayload {
  clanName: string | null;
  members: ClanMemberStats[];
  error?: string;
}

export async function fetchClanStats(): Promise<ClanStatsPayload> {
  const res = await fetch("/api/bungie/clan-stats");
  const json = (await res.json().catch(() => null)) as ClanStatsPayload | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

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
  /** Famille d'activité : elle décide de l'icône et du filtre. */
  family: ActivityFamily;
  /** Personnage qui a joué la partie, pour un historique mélangé. */
  characterId: string;
  className: string;
  image?: string;
  duration: string;
  /** Durée brute, pour additionner un temps de jeu sur plusieurs parties. */
  durationSeconds: number;
  completed: boolean;
  /** 0 victoire, 1 défaite, undefined hors PvP */
  standing?: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: string;
}

function activityRow(
  defs: Defs,
  entry: ActivityHistoryEntry,
  character: { id: string; className: string }
): ActivityRow {
  const def = defs.activities?.[entry.activityDetails.directorActivityHash];
  const standingRaw = entry.values?.standing?.basic?.value;
  const name = def?.displayProperties?.name || "Activité inconnue";
  return {
    instanceId: entry.activityDetails.instanceId,
    when: formatWhen(entry.period),
    date: entry.period,
    name,
    mode: modeName(defs, entry.activityDetails.mode),
    family: activityFamily({
      mode: entry.activityDetails.mode,
      modes: entry.activityDetails.modes,
      name,
    }),
    characterId: character.id,
    className: character.className,
    image: def?.pgcrImage,
    duration: formatDuration(num(entry.values, "activityDurationSeconds")),
    durationSeconds: num(entry.values, "activityDurationSeconds"),
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
  page: ActivityHistoryPage,
  character: { id: string; className: string }
): ActivityRow[] {
  return (page.activities ?? []).map((entry) =>
    activityRow(defs, entry, character)
  );
}

/**
 * Fusionne les historiques de plusieurs personnages en un seul fil.
 *
 * Trois onglets séparés obligeaient à choisir un personnage avant de voir
 * quoi que ce soit, alors qu'une soirée de jeu passe souvent de l'un à
 * l'autre. Un seul fil, trié par date, raconte la soirée telle qu'elle a eu
 * lieu.
 */
export function mergeActivityRows(rows: ActivityRow[][]): ActivityRow[] {
  // Deux pages qui se chevauchent renverraient deux fois la même partie ; une
  // activité jouée à deux personnages, elle, compte bien pour deux lignes.
  const seen = new Map<string, ActivityRow>();
  for (const row of rows.flat()) {
    seen.set(`${row.characterId}-${row.instanceId}`, row);
  }
  return [...seen.values()].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );
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

/** Une arme agrégée depuis les rapports de fin de partie. */
export interface RecentWeaponRow extends WeaponRow {
  games: number;
  killsPerGame: string;
}

export function toRecentWeaponRows(
  defs: Defs,
  payload: RecentWeaponsPayload
): RecentWeaponRow[] {
  return payload.weapons.map((w) => {
    const def = defs.items?.[w.itemHash];
    return {
      itemHash: w.itemHash,
      name: def?.displayProperties?.name ?? `Arme ${w.itemHash}`,
      icon: def?.displayProperties?.icon,
      typeName: def?.itemTypeDisplayName ?? "",
      kills: w.kills,
      precisionKills: w.precisionKills,
      precisionRatio:
        w.kills > 0 ? `${Math.round((w.precisionKills / w.kills) * 100)} %` : "—",
      games: w.games,
      killsPerGame: w.games > 0 ? (w.kills / w.games).toFixed(1) : "—",
    };
  });
}

export interface AggregateRow {
  activityHash: number;
  name: string;
  mode: string;
  image?: string;
  completions: number;
  kills: number;
  deaths: number;
  /** Valeurs brutes : additionner des durées déjà mises en forme n'a pas de sens. */
  playtimeSeconds: number;
  fastestSeconds: number;
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
      playtimeSeconds: num(activity.values, "activitySecondsPlayed"),
      fastestSeconds: fastestMs > 0 ? Math.round(fastestMs / 1000) : 0,
    });
  }
  rows.sort((a, b) => b.completions - a.completions);
  return rows;
}

// ---------------------------------------------------------------------------
// Carrière
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Carrière, dite en français
// ---------------------------------------------------------------------------

/*
 * L'ancienne version recopiait les compteurs de Bungie tels quels : trois
 * tableaux nommés « allPvE », « allPvECompetitive » et « efficiency », sans
 * dire ce que ces mots comptent ni ce qu'un bon chiffre vaudrait. On les
 * traduit donc, on regroupe ce qui se compare, et chaque nombre porte la
 * phrase qui explique d'où il vient.
 */

/** Groupes Bungie qu'on sait présenter, dans l'ordre d'affichage. */
const DOMAINS: {
  key: string;
  label: string;
  icon: string;
  subtitle: string;
}[] = [
  {
    key: "allPvE",
    label: "PvE",
    icon: ICONS.activity,
    subtitle: "Tout ce qui se joue contre l'ordinateur : patrouilles, assauts, donjons, raids.",
  },
  {
    key: "allPvP",
    label: "Creuset",
    icon: "ra-crossed-sabres",
    subtitle: "Le joueur contre joueur, Épreuves et Bannière de Fer comprises.",
  },
  {
    key: "allPvECompetitive",
    label: "Gambit",
    icon: "ra-gold-bar",
    subtitle: "Le mode mixte : on farme des motes d'un côté, on envahit de l'autre.",
  },
  {
    key: "raid",
    label: "Raids",
    icon: "ra-dragon",
    subtitle: "Les six joueurs du contenu le plus exigeant du jeu.",
  },
];

export interface CareerStat {
  label: string;
  value: string;
  /** La phrase qui dit ce que le nombre compte réellement. */
  hint: string;
  /** Mis en avant : c'est le chiffre qui résume la carte. */
  strong?: boolean;
}

export interface CareerDomain {
  key: string;
  label: string;
  icon: string;
  subtitle: string;
  stats: CareerStat[];
}

export interface CareerView {
  /** Les quatre nombres qui résument une carrière. */
  highlights: CareerStat[];
  domains: CareerDomain[];
  /** Vrai quand Bungie n'a renvoyé aucun compteur exploitable. */
  empty: boolean;
}

type Results = Record<string, { allTime?: Record<string, StatsValue> }>;

function statValue(results: Results, group: string, key: string): number {
  const raw = results[group]?.allTime?.[key]?.basic?.value;
  return typeof raw === "number" ? raw : 0;
}

/** Somme d'un compteur sur plusieurs groupes (le temps de jeu total, par exemple). */
function sumOver(results: Results, groups: string[], key: string): number {
  return groups.reduce((total, g) => total + statValue(results, g, key), 0);
}

function maxOver(results: Results, groups: string[], key: string): number {
  return groups.reduce((max, g) => Math.max(max, statValue(results, g, key)), 0);
}

/** « 3 j 04 h », « 12 h 30 » — un temps de jeu se lit en jours, pas en secondes. */
export function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days} j ${String(hours).padStart(2, "0")} h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

function ratio(top: number, bottom: number): string {
  if (bottom <= 0) return top > 0 ? "∞" : "—";
  return (top / bottom).toFixed(2);
}

function percent(top: number, bottom: number): string {
  if (bottom <= 0) return "—";
  return `${Math.round((top / bottom) * 100)} %`;
}

const PLAYED_GROUPS = ["allPvE", "allPvP", "allPvECompetitive"];

export function toCareerView(stats: AccountHistoricalStats): CareerView {
  const results = (stats.mergedAllCharacters?.results ?? {}) as Results;
  if (Object.keys(results).length === 0) {
    return { highlights: [], domains: [], empty: true };
  }

  const played = sumOver(results, PLAYED_GROUPS, "secondsPlayed");
  const cleared = sumOver(results, PLAYED_GROUPS, "activitiesCleared");
  const entered = sumOver(results, PLAYED_GROUPS, "activitiesEntered");
  const kills = sumOver(results, PLAYED_GROUPS, "kills");
  const deaths = sumOver(results, PLAYED_GROUPS, "deaths");

  const highlights: CareerStat[] = [
    {
      label: "Temps de jeu",
      value: formatPlaytime(played),
      hint: "Manette en main, PvE et Creuset confondus. Les temps de chargement et l'orbite ne comptent pas.",
      strong: true,
    },
    {
      label: "Activités terminées",
      value: formatNumber(cleared),
      hint:
        entered > 0
          ? `Sur ${formatNumber(entered)} lancées, soit ${percent(cleared, entered)} menées au bout.`
          : "Celles que tu as menées jusqu'à l'écran de fin.",
    },
    {
      label: "Éliminations",
      value: formatNumber(kills),
      hint: `Pour ${formatNumber(deaths)} morts, soit ${ratio(kills, deaths)} élimination${
        kills / Math.max(1, deaths) >= 2 ? "s" : ""
      } par mort.`,
    },
    {
      label: "Meilleure série",
      value: formatNumber(maxOver(results, PLAYED_GROUPS, "longestKillSpree")),
      hint: "Le plus grand nombre d'ennemis abattus sans mourir une seule fois.",
    },
  ];

  const domains: CareerDomain[] = [];
  for (const domain of DOMAINS) {
    const group = results[domain.key];
    if (!group?.allTime) continue;

    const g = (key: string) => statValue(results, domain.key, key);
    const domainKills = g("kills");
    const domainDeaths = g("deaths");
    const domainEntered = g("activitiesEntered");
    const domainCleared = g("activitiesCleared");
    const wins = g("activitiesWon");
    const stats: CareerStat[] = [];

    if (g("secondsPlayed") > 0) {
      stats.push({
        label: "Temps passé",
        value: formatPlaytime(g("secondsPlayed")),
        hint: "Le temps que tu as consacré à ce type de contenu.",
        strong: true,
      });
    }
    if (domainEntered > 0) {
      stats.push({
        label: domain.key === "raid" ? "Raids terminés" : "Terminées",
        value: `${formatNumber(domainCleared)} / ${formatNumber(domainEntered)}`,
        hint: `Terminées sur lancées : ${percent(domainCleared, domainEntered)} vont au bout.`,
      });
    }
    if (domain.key === "allPvP" || domain.key === "allPvECompetitive") {
      stats.push({
        label: "Victoires",
        value: `${formatNumber(wins)} · ${percent(wins, domainEntered)}`,
        hint: "Parties gagnées, et leur part dans les parties jouées.",
      });
      stats.push({
        label: "K/D",
        value: ratio(domainKills, domainDeaths),
        hint: "Éliminations divisées par morts. Au-dessus de 1, tu élimines plus souvent que tu ne tombes.",
      });
      stats.push({
        label: "Efficacité",
        value: (
          (domainKills + g("assists")) /
          Math.max(1, domainDeaths)
        ).toFixed(2),
        hint: "Éliminations et assistances rapportées aux morts : elle récompense le jeu d'équipe, pas seulement le dernier coup.",
      });
    } else {
      stats.push({
        label: "Éliminations",
        value: formatNumber(domainKills),
        hint: `Pour ${formatNumber(domainDeaths)} morts.`,
      });
      if (g("precisionKills") > 0) {
        stats.push({
          label: "Tirs à la tête",
          value: percent(g("precisionKills"), domainKills),
          hint: "Part des éliminations obtenues sur un point faible.",
        });
      }
    }
    if (g("bestSingleGameKills") > 0) {
      stats.push({
        label: "Record sur une partie",
        value: formatNumber(g("bestSingleGameKills")),
        hint: "Ton meilleur total d'éliminations en une seule activité.",
      });
    }

    if (stats.length > 0) domains.push({ ...domain, stats });
  }

  return { highlights, domains, empty: domains.length === 0 };
}
