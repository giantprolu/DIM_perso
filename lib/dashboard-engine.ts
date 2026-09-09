import {
  ARMOR_SLOT_ORDER,
  BUCKET_POSTMASTER,
  BUCKET_PURSUITS,
  CLASS_NAMES,
  ITEM_TYPE_BOUNTY,
  ITEM_TYPE_QUEST,
  ITEM_TYPE_QUEST_STEP,
  WEAPON_SLOT_ORDER,
} from "./destiny-constants";
import { activityFamily, type ActivityFamily } from "./rpg-icons";
import { buildArtifact, buildRanks, buildSeasonPass } from "./weekly-engine";
import type {
  ActivityHistoryPage,
  Character,
  Defs,
  ProfileResponse,
} from "./types";
import type {
  ArtifactView,
  RankView,
  SeasonPassView,
} from "./weekly-engine";

/**
 * Moteur du tableau de bord.
 *
 * Il ne va rien chercher de neuf : il relit la réponse de `/api/bungie/dashboard`
 * et en tire les quelques nombres qui décident de ce qu'on va faire en jouant —
 * la puissance réelle, ce qui expire, ce qui déborde, où en sont les rangs.
 * Tout ce qui demanderait un hash codé en dur (une prime précise, une activité
 * de la saison) est délibérément absent : le tableau de bord doit survivre au
 * changement de saison sans qu'on y touche.
 */

/** Au-delà, le maître des postes commence à écraser les objets les plus anciens. */
export const POSTMASTER_CAP = 21;
const POSTMASTER_WARN = 15;

/** Une prime en dessous de ce seuil mérite d'être signalée. */
const EXPIRY_WARN_MS = 24 * 3_600_000;

export interface CurrentActivity {
  name: string;
  modeName: string;
  family: ActivityFamily;
  since?: string;
}

export interface PostmasterState {
  count: number;
  /** Le nombre d'objets s'approche de la limite : il faut vider. */
  urgent: boolean;
}

export interface PursuitState {
  total: number;
  quests: number;
  bounties: number;
  /** Poursuites dont le compte à rebours passe sous les 24 heures. */
  expiringSoon: number;
}

export interface CharacterCard {
  characterId: string;
  className: string;
  classType: number;
  /** Puissance telle que Bungie la donne pour ce personnage. */
  light: number;
  /** Moyenne des huit pièces portées : la puissance de l'équipement seul. */
  gearPower: number;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  title?: string;
  lastPlayed: string;
  hoursPlayed: number;
  currentActivity: CurrentActivity | null;
  postmaster: PostmasterState;
  pursuits: PursuitState;
  /** Jalons du personnage qu'il reste à terminer. */
  milestonesLeft: number;
  milestonesTotal: number;
}

export interface CurrencyView {
  itemHash: number;
  name: string;
  icon?: string;
  quantity: number;
}

export interface RecentActivity {
  instanceId: string;
  characterId: string;
  className: string;
  name: string;
  modeName: string;
  family: ActivityFamily;
  date: string;
  durationSeconds: number;
  completed: boolean;
  kills: number;
  deaths: number;
  standing?: number;
}

export type AlertLevel = "danger" | "warning" | "info";

export interface Alert {
  key: string;
  level: AlertLevel;
  icon: string;
  title: string;
  detail: string;
  href?: string;
}

export interface PowerSummary {
  /** Meilleure moyenne d'équipement parmi les personnages. */
  gear: number;
  artifact: number;
  total: number;
}

export interface DashboardView {
  playerName: string;
  playerCode?: number;
  playerIcon?: string;
  guardianRank: number;
  highestGuardianRank: number;
  guardianRankName: string;
  characters: CharacterCard[];
  power: PowerSummary;
  artifact: ArtifactView | null;
  seasonPass: SeasonPassView | null;
  seasonName: string;
  currencies: CurrencyView[];
  ranks: RankView[];
  recent: RecentActivity[];
  alerts: Alert[];
  totalHoursPlayed: number;
}

// ---------------------------------------------------------------------------
// Petites lectures
// ---------------------------------------------------------------------------

function gearPowerOf(
  profile: ProfileResponse,
  characterId: string
): number {
  const items = profile.characterEquipment?.data?.[characterId]?.items ?? [];
  const instances = profile.itemComponents?.instances?.data ?? {};
  const slots = new Set([...WEAPON_SLOT_ORDER, ...ARMOR_SLOT_ORDER]);
  const powers: number[] = [];
  for (const item of items) {
    if (!slots.has(item.bucketHash) || !item.itemInstanceId) continue;
    const power = instances[item.itemInstanceId]?.primaryStat?.value ?? 0;
    if (power > 0) powers.push(power);
  }
  if (powers.length === 0) return 0;
  // Le jeu tronque la moyenne, il ne l'arrondit pas.
  return Math.floor(powers.reduce((a, v) => a + v, 0) / powers.length);
}

/** Le sceau porté, décliné selon le genre du personnage. */
function titleOf(defs: Defs, character: Character): string | undefined {
  const hash = character.titleRecordHash;
  if (!hash) return undefined;
  const titles = defs.records?.[hash]?.titleInfo?.titlesByGender;
  if (!titles) return undefined;
  const key = character.genderType === 1 ? "Female" : "Male";
  return titles[key] ?? Object.values(titles)[0];
}

function currentActivityOf(
  defs: Defs,
  profile: ProfileResponse,
  characterId: string
): CurrentActivity | null {
  const state = profile.characterActivities?.data?.[characterId];
  const hash = state?.currentActivityHash;
  if (!hash) return null;
  const def = defs.activities?.[hash];
  const name = def?.displayProperties?.name;
  if (!name) return null;

  const modeDef = state.currentActivityModeHash
    ? defs.activityModes?.[state.currentActivityModeHash]
    : undefined;
  return {
    name,
    modeName: modeDef?.displayProperties?.name ?? "",
    family: activityFamily({
      mode: state.currentActivityModeType,
      modes: def?.activityModeHashes
        ?.map((h) => defs.activityModes?.[h]?.modeType)
        .filter((m): m is number => m !== undefined),
      name,
    }),
    since: state.dateActivityStarted,
  };
}

function postmasterOf(
  profile: ProfileResponse,
  characterId: string
): PostmasterState {
  const items = profile.characterInventories?.data?.[characterId]?.items ?? [];
  const count = items.filter((i) => i.bucketHash === BUCKET_POSTMASTER).length;
  return { count, urgent: count >= POSTMASTER_WARN };
}

function pursuitsOf(
  defs: Defs,
  profile: ProfileResponse,
  characterId: string
): PursuitState {
  const items = profile.characterInventories?.data?.[characterId]?.items ?? [];
  const now = Date.now();
  let quests = 0;
  let bounties = 0;
  let expiringSoon = 0;

  for (const item of items) {
    if (item.bucketHash !== BUCKET_PURSUITS) continue;
    const def = defs.items?.[item.itemHash];
    if (def?.itemType === ITEM_TYPE_BOUNTY) bounties++;
    else if (
      def?.itemType === ITEM_TYPE_QUEST ||
      def?.itemType === ITEM_TYPE_QUEST_STEP ||
      def?.setData
    ) {
      quests++;
    }
    if (item.expirationDate) {
      const left = new Date(item.expirationDate).getTime() - now;
      if (left > 0 && left < EXPIRY_WARN_MS) expiringSoon++;
    }
  }
  return { total: quests + bounties, quests, bounties, expiringSoon };
}

function milestoneCountsOf(
  profile: ProfileResponse,
  characterId: string
): { left: number; total: number } {
  const milestones =
    profile.characterProgressions?.data?.[characterId]?.milestones ?? {};
  let total = 0;
  let left = 0;
  for (const m of Object.values(milestones)) {
    const rewards = m.rewards ?? [];
    const entries = rewards.flatMap((r) => r.entries ?? []);
    // Sans récompense listée, un jalon ne dit pas s'il est fait : on ne
    // l'inclut pas plutôt que de gonfler un compteur faux.
    if (entries.length === 0) continue;
    total++;
    if (!entries.every((e) => e.earned || e.redeemed)) left++;
  }
  return { left, total };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface DashboardPayload {
  profile: ProfileResponse;
  recent?: Record<string, ActivityHistoryPage> | null;
}

export function buildDashboard(
  defs: Defs,
  payload: DashboardPayload
): DashboardView {
  const { profile } = payload;
  const characters = Object.values(profile.characters?.data ?? {}).sort(
    (a, b) =>
      new Date(b.dateLastPlayed).getTime() - new Date(a.dateLastPlayed).getTime()
  );

  const cards: CharacterCard[] = characters.map((c) => {
    const counts = milestoneCountsOf(profile, c.characterId);
    return {
      characterId: c.characterId,
      className: CLASS_NAMES[c.classType] ?? "Gardien",
      classType: c.classType,
      light: c.light,
      gearPower: gearPowerOf(profile, c.characterId),
      emblemPath: c.emblemPath,
      emblemBackgroundPath: c.emblemBackgroundPath,
      title: titleOf(defs, c),
      lastPlayed: c.dateLastPlayed,
      hoursPlayed: Math.round(Number(c.minutesPlayedTotal ?? 0) / 60),
      currentActivity: currentActivityOf(defs, profile, c.characterId),
      postmaster: postmasterOf(profile, c.characterId),
      pursuits: pursuitsOf(defs, profile, c.characterId),
      milestonesLeft: counts.left,
      milestonesTotal: counts.total,
    };
  });

  // Le personnage joué en dernier sert de référence pour tout ce qui est
  // propre à un personnage mais vaut pour le compte (artefact, rangs).
  const mainId = cards[0]?.characterId ?? "";
  const mainProgressions = profile.characterProgressions?.data?.[mainId];

  const artifact = buildArtifact(defs, profile, mainId);
  const seasonPass = buildSeasonPass(defs, profile, mainProgressions);
  const ranks = buildRanks(defs, mainProgressions);

  const gear = cards.reduce((max, c) => Math.max(max, c.gearPower), 0);
  const artifactBonus = artifact?.powerBonus ?? 0;

  const seasonHash = profile.profile?.data?.currentSeasonHash;
  const seasonName = seasonHash
    ? (defs.seasons?.[seasonHash]?.displayProperties?.name ?? "")
    : "";

  const guardianRank = profile.profile?.data?.currentGuardianRank ?? 0;
  const rankDef = Object.values(defs.guardianRanks ?? {}).find(
    (r) => r.rankNumber === guardianRank
  );

  const info = profile.profile?.data?.userInfo;

  return {
    playerName:
      info?.bungieGlobalDisplayName || info?.displayName || "Gardien",
    playerCode: info?.bungieGlobalDisplayNameCode,
    playerIcon: info?.iconPath,
    guardianRank,
    highestGuardianRank: profile.profile?.data?.lifetimeHighestGuardianRank ?? 0,
    guardianRankName: rankDef?.displayProperties?.name ?? "",
    characters: cards,
    power: { gear, artifact: artifactBonus, total: gear + artifactBonus },
    artifact,
    seasonPass,
    seasonName,
    currencies: buildCurrencies(defs, profile),
    ranks,
    recent: buildRecent(defs, payload, cards),
    alerts: buildAlerts(cards),
    totalHoursPlayed: cards.reduce((a, c) => a + c.hoursPlayed, 0),
  };
}

/**
 * Les devises que Bungie épingle lui-même (composant 103) : éclat, poussière,
 * noyaux… La liste évolue à chaque saison, on la prend telle quelle plutôt
 * que d'entretenir une collection de hashs.
 */
function buildCurrencies(
  defs: Defs,
  profile: ProfileResponse
): CurrencyView[] {
  const out: CurrencyView[] = [];
  for (const item of profile.profileCurrencies?.data?.items ?? []) {
    const def = defs.items?.[item.itemHash];
    const name = def?.displayProperties?.name;
    if (!name) continue;
    out.push({
      itemHash: item.itemHash,
      name,
      icon: def?.displayProperties?.icon,
      quantity: item.quantity,
    });
  }
  return out;
}

/**
 * `modeType` → nom du mode.
 *
 * Le manifest indexe les modes par hash alors que l'historique renvoie un
 * `modeType` : sans index inverse, chaque ligne relancerait une recherche
 * linéaire sur les deux cents modes du jeu.
 */
function modeIndex(defs: Defs): Map<number, string> {
  const index = new Map<number, string>();
  for (const def of Object.values(defs.activityModes ?? {})) {
    if (def.modeType !== undefined) {
      index.set(def.modeType, def.displayProperties?.name ?? "");
    }
  }
  return index;
}

function buildRecent(
  defs: Defs,
  payload: DashboardPayload,
  cards: CharacterCard[]
): RecentActivity[] {
  const classById = new Map(cards.map((c) => [c.characterId, c.className]));
  const modes = modeIndex(defs);
  const rows: RecentActivity[] = [];

  for (const [characterId, page] of Object.entries(payload.recent ?? {})) {
    for (const entry of page.activities ?? []) {
      const def = defs.activities?.[entry.activityDetails.directorActivityHash];
      const name = def?.displayProperties?.name || "Activité inconnue";
      const modeType = entry.activityDetails.mode;
      const standing = entry.values?.standing?.basic?.value;
      rows.push({
        instanceId: entry.activityDetails.instanceId,
        characterId,
        className: classById.get(characterId) ?? "",
        name,
        modeName: modes.get(modeType ?? -1) ?? "",
        family: activityFamily({
          mode: modeType,
          modes: entry.activityDetails.modes,
          name,
        }),
        date: entry.period,
        durationSeconds:
          entry.values?.activityDurationSeconds?.basic?.value ?? 0,
        completed: (entry.values?.completed?.basic?.value ?? 0) > 0,
        kills: entry.values?.kills?.basic?.value ?? 0,
        deaths: entry.values?.deaths?.basic?.value ?? 0,
        standing:
          standing === undefined || standing < 0 ? undefined : standing,
      });
    }
  }

  rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return rows.slice(0, 8);
}

/**
 * Ce qui va coûter quelque chose si on ne le fait pas : un maître des postes
 * qui déborde efface des objets, une prime expirée est perdue sèche.
 */
function buildAlerts(cards: CharacterCard[]): Alert[] {
  const alerts: Alert[] = [];

  for (const card of cards) {
    if (card.postmaster.urgent) {
      alerts.push({
        key: `postmaster-${card.characterId}`,
        level: card.postmaster.count >= POSTMASTER_CAP ? "danger" : "warning",
        icon: "ra-key",
        title: `Maître des postes plein — ${card.className}`,
        detail: `${card.postmaster.count}/${POSTMASTER_CAP} objets. Au-delà, les plus anciens sont effacés.`,
        href: "/postmaster",
      });
    }
    if (card.pursuits.expiringSoon > 0) {
      alerts.push({
        key: `expiry-${card.characterId}`,
        level: "warning",
        icon: "ra-hourglass",
        title: `${card.pursuits.expiringSoon} poursuite${
          card.pursuits.expiringSoon > 1 ? "s" : ""
        } expire${card.pursuits.expiringSoon > 1 ? "nt" : ""} — ${card.className}`,
        detail: "Moins de 24 heures avant qu'elles ne disparaissent.",
        href: "/quests",
      });
    }
  }

  return alerts.sort((a, b) => {
    const weight = { danger: 0, warning: 1, info: 2 };
    return weight[a.level] - weight[b.level];
  });
}
