import {
  ARMOR_STAT_HASHES,
  ITEM_STATE_CRAFTED,
  ITEM_STATE_LOCKED,
  ITEM_STATE_MASTERWORK,
  SOCKET_CATEGORY_ARMOR_MODS,
  SOCKET_CATEGORY_WEAPON_MODS,
  SOCKET_CATEGORY_WEAPON_PERKS,
  TIER_EXOTIC,
} from "./destiny-constants";
import type { Defs, ProfileItem, ProfileResponse } from "./types";

/**
 * Détail complet d'un objet, aussi riche que ce que l'API expose :
 * stats chiffrées, perks, mods, état (chef-d'œuvre, façonné, verrouillé),
 * énergie, élément, puissance.
 */

export interface DetailPlug {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
  /** L'option actuellement posée dans cet emplacement */
  active: boolean;
}

export interface DetailSocket {
  socketIndex: number;
  plugs: DetailPlug[];
}

export interface DetailStat {
  hash: number;
  name: string;
  value: number;
  /** Valeur maximale connue pour la barre (armure : 200, armes : 100) */
  max: number;
}

export interface ItemDetail {
  instanceId: string;
  itemHash: number;
  name: string;
  icon?: string;
  screenshot?: string;
  flavorText?: string;
  typeName: string;
  tierName: string;
  isExotic: boolean;
  power: number;
  damageName?: string;
  damageIcon?: string;
  energyCapacity: number;
  energyUsed: number;
  isMasterwork: boolean;
  isCrafted: boolean;
  isLocked: boolean;
  stats: DetailStat[];
  perkSockets: DetailSocket[];
  modSockets: DetailSocket[];
  isWeapon: boolean;
}

function socketsOfCategory(
  defs: Defs,
  itemHash: number,
  categoryHash: number
): number[] {
  return (
    defs.items[itemHash]?.sockets?.socketCategories?.find(
      (c) => c.socketCategoryHash === categoryHash
    )?.socketIndexes ?? []
  );
}

function buildSockets(
  defs: Defs,
  data: ProfileResponse,
  instanceId: string,
  itemHash: number,
  categoryHash: number
): DetailSocket[] {
  const states =
    data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const reusable =
    data.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs ?? {};
  const out: DetailSocket[] = [];

  for (const socketIndex of socketsOfCategory(defs, itemHash, categoryHash)) {
    const state = states[socketIndex];
    if (state?.isVisible === false) continue;
    const activeHash = state?.plugHash;
    const candidates = new Set<number>();
    if (activeHash) candidates.add(activeHash);
    for (const p of reusable[String(socketIndex)] ?? []) {
      candidates.add(p.plugItemHash);
    }
    const plugs: DetailPlug[] = [];
    for (const hash of candidates) {
      const def = defs.items[hash];
      const name = def?.displayProperties?.name;
      if (!name) continue;
      plugs.push({
        hash,
        name,
        icon: def?.displayProperties?.icon,
        description: def?.displayProperties?.description,
        active: hash === activeHash,
      });
    }
    if (plugs.length > 0) out.push({ socketIndex, plugs });
  }
  return out;
}

export function buildItemDetail(
  defs: Defs,
  data: ProfileResponse,
  item: ProfileItem
): ItemDetail | null {
  const instanceId = item.itemInstanceId;
  if (!instanceId) return null;
  const def = defs.items[item.itemHash];
  if (!def) return null;

  const inst = data.itemComponents?.instances?.data?.[instanceId];
  const statValues = data.itemComponents?.stats?.data?.[instanceId]?.stats ?? {};
  const state = item.state ?? 0;
  const isWeapon = def.itemType === 3;

  const stats: DetailStat[] = Object.values(statValues)
    .map((s) => ({
      hash: s.statHash,
      name: defs.stats?.[s.statHash]?.displayProperties?.name ?? `Stat`,
      value: s.value,
      max: ARMOR_STAT_HASHES.includes(s.statHash) ? 200 : 100,
    }))
    // La puissance est affichée à part
    .filter((s) => s.hash !== 1935470627 && s.name !== "Stat")
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const damageDef = inst?.damageTypeHash
    ? defs.damageTypes?.[inst.damageTypeHash]
    : undefined;

  // Énergie consommée = somme des coûts des mods posés
  let energyUsed = 0;
  const socketStates =
    data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  for (const s of socketStates) {
    if (!s.plugHash) continue;
    energyUsed += defs.items[s.plugHash]?.plug?.energyCost?.energyCost ?? 0;
  }

  return {
    instanceId,
    itemHash: item.itemHash,
    name: def.displayProperties?.name ?? "Objet",
    icon: def.displayProperties?.icon,
    screenshot: def.screenshot,
    flavorText: def.flavorText,
    typeName: def.itemTypeDisplayName ?? "",
    tierName: def.inventory?.tierTypeName ?? "",
    isExotic: def.inventory?.tierType === TIER_EXOTIC,
    power: inst?.primaryStat?.value ?? 0,
    damageName: damageDef?.displayProperties?.name,
    damageIcon: damageDef?.displayProperties?.icon,
    energyCapacity: inst?.energy?.energyCapacity ?? 0,
    energyUsed,
    isMasterwork: (state & ITEM_STATE_MASTERWORK) !== 0,
    isCrafted: (state & ITEM_STATE_CRAFTED) !== 0,
    isLocked: (state & ITEM_STATE_LOCKED) !== 0,
    stats,
    perkSockets: isWeapon
      ? buildSockets(
          defs,
          data,
          instanceId,
          item.itemHash,
          SOCKET_CATEGORY_WEAPON_PERKS
        )
      : [],
    modSockets: buildSockets(
      defs,
      data,
      instanceId,
      item.itemHash,
      isWeapon ? SOCKET_CATEGORY_WEAPON_MODS : SOCKET_CATEGORY_ARMOR_MODS
    ),
    isWeapon,
  };
}

/**
 * Doublons : mêmes itemHash détenus en plusieurs exemplaires.
 * Utile pour repérer ce qui peut être fusionné en jeu (l'API ne permet pas
 * de le faire à distance) ou simplement démantelé.
 */
export interface DuplicateGroup {
  itemHash: number;
  name: string;
  icon?: string;
  typeName: string;
  isExotic: boolean;
  copies: { instanceId: string; power: number; locked: boolean }[];
}

export function findDuplicates(
  defs: Defs,
  data: ProfileResponse,
  itemType: number
): DuplicateGroup[] {
  const all: ProfileItem[] = [
    ...(data.profileInventory?.data?.items ?? []),
    ...Object.values(data.characterInventories?.data ?? {}).flatMap(
      (i) => i.items
    ),
    ...Object.values(data.characterEquipment?.data ?? {}).flatMap(
      (i) => i.items
    ),
  ];
  const instances = data.itemComponents?.instances?.data ?? {};
  const groups = new Map<number, DuplicateGroup>();

  for (const item of all) {
    if (!item.itemInstanceId) continue;
    const def = defs.items[item.itemHash];
    if (!def || def.itemType !== itemType) continue;
    let group = groups.get(item.itemHash);
    if (!group) {
      group = {
        itemHash: item.itemHash,
        name: def.displayProperties?.name ?? "Objet",
        icon: def.displayProperties?.icon,
        typeName: def.itemTypeDisplayName ?? "",
        isExotic: def.inventory?.tierType === TIER_EXOTIC,
        copies: [],
      };
      groups.set(item.itemHash, group);
    }
    group.copies.push({
      instanceId: item.itemInstanceId,
      power: instances[item.itemInstanceId]?.primaryStat?.value ?? 0,
      locked: ((item.state ?? 0) & ITEM_STATE_LOCKED) !== 0,
    });
  }

  return [...groups.values()]
    .filter((g) => g.copies.length > 1)
    .map((g) => ({
      ...g,
      copies: g.copies.sort((a, b) => b.power - a.power),
    }))
    .sort((a, b) => b.copies.length - a.copies.length);
}
