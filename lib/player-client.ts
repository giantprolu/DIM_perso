import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  CLASS_NAMES,
  TIER_EXOTIC,
  WEAPON_SLOT_ORDER,
} from "./destiny-constants";
import type { Character, Defs, ProfileResponse } from "./types";

/**
 * Lecture de la fiche d'un autre joueur (membre du clan).
 *
 * Bungie ne refuse pas un profil restreint : il renvoie le composant sans
 * `data` et avec `privacy: 2`. Tout ce module distingue donc « rien à
 * montrer » (profil privé) de « erreur ».
 */

export interface PlayerData {
  profile: ProfileResponse;
  historical: HistoricalStats | null;
}

interface HistoricalStats {
  mergedAllCharacters?: {
    results?: Record<
      string,
      { allTime?: Record<string, { basic?: { value?: number; displayValue?: string } }> }
    >;
  };
}

export const PLATFORM_NAMES: Record<number, string> = {
  1: "Xbox",
  2: "PlayStation",
  3: "Steam",
  4: "Blizzard",
  5: "Stadia",
  6: "Epic Games",
  10: "Demon",
  254: "Bungie.net",
};

/**
 * Cache mémoire par joueur. Le survol d'une liste déclenche vite beaucoup de
 * requêtes : sans cela, chaque aller-retour de la souris en relancerait une.
 */
const cache = new Map<string, { at: number; data: PlayerData }>();
const inflight = new Map<string, Promise<PlayerData>>();
/** L'activité en cours se périme vite — au-delà, on relit. */
const TTL_MS = 60_000;

export function playerKey(type: number, id: string, light: boolean): string {
  return `${type}/${id}/${light ? "light" : "full"}`;
}

export async function fetchPlayer(
  membershipType: number,
  membershipId: string,
  light: boolean
): Promise<PlayerData> {
  const key = playerKey(membershipType, membershipId, light);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const running = inflight.get(key);
  if (running) return running;

  const promise = (async () => {
    const res = await fetch(
      `/api/bungie/player?type=${membershipType}&id=${membershipId}${light ? "&light=1" : ""}`,
      { cache: "no-store" }
    );
    const json = (await res.json().catch(() => null)) as
      | (PlayerData & { error?: string })
      | null;
    if (!res.ok || !json || json.error) {
      throw new Error(json?.error ?? `HTTP ${res.status}`);
    }
    cache.set(key, { at: Date.now(), data: json });
    return json;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

/** Une fiche complète est aussi une fiche légère : on la réutilise. */
export function cachedPlayer(
  membershipType: number,
  membershipId: string
): PlayerData | null {
  const full = cache.get(playerKey(membershipType, membershipId, false));
  if (full && Date.now() - full.at < TTL_MS) return full.data;
  const light = cache.get(playerKey(membershipType, membershipId, true));
  if (light && Date.now() - light.at < TTL_MS) return light.data;
  return null;
}

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

export interface ActivityInfo {
  name: string;
  mode?: string;
  image?: string;
  /** Depuis quand, en minutes */
  sinceMinutes?: number;
}

export interface CharacterView {
  characterId: string;
  className: string;
  classType: number;
  raceName?: string;
  title?: string;
  light: number;
  level?: number;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  minutesPlayed: number;
  dateLastPlayed?: string;
  /** Les 6 stats d'armure, alignées sur ARMOR_STAT_HASHES */
  stats: number[];
  activity: ActivityInfo | null;
}

export interface EquippedItem {
  bucketHash: number;
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  watermark?: string;
  typeName: string;
  isExotic: boolean;
  power: number;
  damageName?: string;
  damageIcon?: string;
  /** Perks et mods visibles, dans l'ordre des emplacements */
  plugs: { name: string; icon?: string }[];
}

export interface PlayerSummary {
  /** null quand Bungie n'a rien voulu donner (profil privé) */
  characters: CharacterView[] | null;
  maxLight: number;
  totalMinutes: number;
  dateLastPlayed?: string;
  /** Activité en cours, tous personnages confondus */
  currentActivity: ActivityInfo | null;
  privateProfile: boolean;
}

function activityOf(
  defs: Defs,
  data: ProfileResponse,
  characterId: string
): ActivityInfo | null {
  const act = data.characterActivities?.data?.[characterId];
  if (!act?.currentActivityHash) return null;

  const def = defs.activities?.[act.currentActivityHash];
  const modeDef = act.currentActivityModeHash
    ? defs.activityModes?.[act.currentActivityModeHash]
    : undefined;

  // En orbite, Bungie renvoie une activité sans nom : le mode suffit alors.
  const name = def?.displayProperties?.name || modeDef?.displayProperties?.name;
  if (!name) return null;

  let sinceMinutes: number | undefined;
  if (act.dateActivityStarted) {
    const started = new Date(act.dateActivityStarted).getTime();
    if (Number.isFinite(started)) {
      sinceMinutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
    }
  }

  return {
    name,
    mode: modeDef?.displayProperties?.name,
    image: def?.pgcrImage,
    sinceMinutes,
  };
}

function titleOf(defs: Defs, char: Character): string | undefined {
  if (!char.titleRecordHash) return undefined;
  const titles = defs.records?.[char.titleRecordHash]?.titleInfo?.titlesByGender;
  if (!titles) return undefined;
  // Les clés sont "Male"/"Female" ; à défaut on prend la première déclinaison.
  const key = char.genderType === 1 ? "Female" : "Male";
  return titles[key] ?? Object.values(titles)[0];
}

export function summarizePlayer(defs: Defs, data: PlayerData): PlayerSummary {
  const chars = Object.values(data.profile.characters?.data ?? {});
  /*
   * Bungie ne signale pas toujours la restriction par `privacy` : il peut
   * simplement omettre les données. Aucun personnage lisible vaut donc
   * « rien à montrer », plutôt qu'une fiche vide sans explication.
   */
  const isPrivate = chars.length === 0;

  const views: CharacterView[] = chars
    .map((c) => ({
      characterId: c.characterId,
      classType: c.classType,
      className:
        defs.classes?.[c.classHash]?.displayProperties?.name ??
        CLASS_NAMES[c.classType] ??
        "Gardien",
      raceName: c.raceHash
        ? defs.races?.[c.raceHash]?.displayProperties?.name
        : undefined,
      title: titleOf(defs, c),
      light: c.light,
      level: c.baseCharacterLevel,
      emblemPath: c.emblemPath,
      emblemBackgroundPath: c.emblemBackgroundPath,
      minutesPlayed: Number(c.minutesPlayedTotal ?? 0) || 0,
      dateLastPlayed: c.dateLastPlayed,
      stats: ARMOR_STAT_HASHES.map((h) => c.stats?.[h] ?? 0),
      activity: activityOf(defs, data.profile, c.characterId),
    }))
    .sort(
      (a, b) =>
        new Date(b.dateLastPlayed ?? 0).getTime() -
        new Date(a.dateLastPlayed ?? 0).getTime()
    );

  return {
    characters: isPrivate ? null : views,
    maxLight: views.reduce((a, c) => Math.max(a, c.light), 0),
    totalMinutes: views.reduce((a, c) => a + c.minutesPlayed, 0),
    dateLastPlayed: data.profile.profile?.data?.dateLastPlayed,
    currentActivity: views.find((c) => c.activity)?.activity ?? null,
    privateProfile: isPrivate,
  };
}

/**
 * Équipement porté par un personnage, armes puis armure.
 * Renvoie null si le joueur garde son équipement privé.
 */
export function equippedItems(
  defs: Defs,
  data: PlayerData,
  characterId: string
): EquippedItem[] | null {
  const equipment = data.profile.characterEquipment;
  if (!equipment?.data) return null;
  const items = equipment.data[characterId]?.items ?? [];
  const instances = data.profile.itemComponents?.instances?.data ?? {};
  const socketsData = data.profile.itemComponents?.sockets?.data ?? {};

  const order = [...WEAPON_SLOT_ORDER, ...ARMOR_SLOT_ORDER];
  const out: EquippedItem[] = [];

  for (const bucket of order) {
    const item = items.find((i) => i.bucketHash === bucket);
    if (!item?.itemInstanceId) continue;
    const def = defs.items[item.itemHash];
    if (!def) continue;

    const damageHash = instances[item.itemInstanceId]?.damageTypeHash;
    const damage = damageHash ? defs.damageTypes?.[damageHash] : undefined;

    const plugs: { name: string; icon?: string }[] = [];
    for (const socket of socketsData[item.itemInstanceId]?.sockets ?? []) {
      if (!socket.plugHash || socket.isVisible === false) continue;
      const plugDef = defs.items[socket.plugHash];
      const name = plugDef?.displayProperties?.name;
      if (!name) continue;
      plugs.push({ name, icon: plugDef?.displayProperties?.icon });
    }

    out.push({
      bucketHash: bucket,
      instanceId: item.itemInstanceId,
      itemHash: item.itemHash,
      name: def.displayProperties?.name ?? "Objet",
      icon: def.displayProperties?.icon,
      typeName: def.itemTypeDisplayName ?? "",
      isExotic: def.inventory?.tierType === TIER_EXOTIC,
      power: instances[item.itemInstanceId]?.primaryStat?.value ?? 0,
      damageName: damage?.displayProperties?.name,
      damageIcon: damage?.displayProperties?.icon,
      plugs,
    });
  }
  return out;
}

/** Quelques compteurs de carrière, quand Bungie les rend publics. */
export interface CareerStat {
  label: string;
  value: string;
}

const CAREER_FIELDS: { key: string; label: string }[] = [
  { key: "killsDeathsRatio", label: "K/D" },
  { key: "efficiency", label: "Efficacité" },
  { key: "activitiesCleared", label: "Activités terminées" },
  { key: "kills", label: "Éliminations" },
  { key: "deaths", label: "Morts" },
  { key: "assists", label: "Assistances" },
];

export function careerStats(data: PlayerData): CareerStat[] {
  const all = data.historical?.mergedAllCharacters?.results?.allPvE?.allTime;
  if (!all) return [];
  const out: CareerStat[] = [];
  for (const f of CAREER_FIELDS) {
    const entry = all[f.key]?.basic;
    if (!entry) continue;
    const value =
      entry.displayValue ??
      (entry.value !== undefined ? String(Math.round(entry.value)) : null);
    if (value) out.push({ label: f.label, value });
  }
  return out;
}

/** « 3 j 4 h » plutôt que « 4 512 minutes ». */
export function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "—";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${minutes} min`;
}
