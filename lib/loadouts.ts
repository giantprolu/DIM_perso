/**
 * Loadouts côté application, stockés dans le navigateur (localStorage).
 * Un loadout = armes + armures + sous-classe équipées, avec les plugs
 * (mods d'armure, mods d'arme, aspects/fragments) à restaurer.
 */

import {
  ARMOR_SLOT_ORDER,
  BUCKET_SUBCLASS,
  ITEM_TYPE_ARMOR,
  ITEM_TYPE_WEAPON,
  SOCKET_CATEGORY_WEAPON_MODS,
  WEAPON_SLOT_ORDER,
} from "./destiny-constants";
import type { Defs, ProfileResponse } from "./types";

export interface SavedPlug {
  socketIndex: number;
  plugHash: number;
}

export interface SavedItem {
  itemInstanceId: string;
  itemHash: number;
  bucketHash: number;
  plugs: SavedPlug[];
}

export interface Loadout {
  id: string;
  name: string;
  classType: number;
  createdAt: string;
  items: SavedItem[];
}

const KEY = "dim-perso-loadouts";

export const LOADOUT_BUCKETS = new Set<number>([
  ...WEAPON_SLOT_ORDER,
  ...ARMOR_SLOT_ORDER,
  BUCKET_SUBCLASS,
]);

export function loadLoadouts(): Loadout[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Loadout[]) : [];
  } catch {
    return [];
  }
}

export function persistLoadouts(list: Loadout[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Plugs à sauvegarder pour un item équipé donné. */
function capturePlugs(
  defs: Defs,
  data: ProfileResponse,
  instanceId: string,
  itemHash: number
): SavedPlug[] {
  const def = defs.items[itemHash];
  const states = data.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const plugs: SavedPlug[] = [];

  const weaponModIndexes = new Set(
    def?.sockets?.socketCategories?.find(
      (c) => c.socketCategoryHash === SOCKET_CATEGORY_WEAPON_MODS
    )?.socketIndexes ?? []
  );

  for (let i = 0; i < states.length; i++) {
    const plugHash = states[i]?.plugHash;
    if (!plugHash) continue;
    const plugDef = defs.items[plugHash];
    const category = plugDef?.plug?.plugCategoryIdentifier ?? "";

    let keep = false;
    if (def?.itemType === ITEM_TYPE_ARMOR) {
      keep = category.startsWith("enhancements.");
    } else if (def?.itemType === ITEM_TYPE_WEAPON) {
      keep = weaponModIndexes.has(i);
    } else if (def?.inventory?.bucketTypeHash === BUCKET_SUBCLASS) {
      keep = true; // aspects, fragments, capacités
    }
    if (keep) plugs.push({ socketIndex: i, plugHash });
  }
  return plugs;
}

/**
 * Capture l'équipement complet actuellement porté par un personnage
 * (armes + armures + sous-classe, mods et fragments compris).
 */
export function captureEquippedLoadout(
  defs: Defs,
  data: ProfileResponse,
  characterId: string,
  classType: number,
  name: string
): Loadout {
  const equipped = data.characterEquipment?.data?.[characterId]?.items ?? [];
  const items: SavedItem[] = [];
  for (const item of equipped) {
    if (!item.itemInstanceId) continue;
    if (!LOADOUT_BUCKETS.has(item.bucketHash)) continue;
    items.push({
      itemInstanceId: item.itemInstanceId,
      itemHash: item.itemHash,
      bucketHash: item.bucketHash,
      plugs: capturePlugs(defs, data, item.itemInstanceId, item.itemHash),
    });
  }
  return {
    id: crypto.randomUUID(),
    name,
    classType,
    createdAt: new Date().toISOString(),
    items,
  };
}
