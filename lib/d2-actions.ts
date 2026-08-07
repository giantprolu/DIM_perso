import { ARMOR_STAT_HASHES, BUCKET_POSTMASTER } from "./destiny-constants";
import type { Defs, ProfileResponse } from "./types";

/** POST JSON vers nos routes /api/d2/*, avec remontée d'erreur lisible. */
async function apiPost<T = { ok: boolean }>(
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

export const transferItem = (p: {
  itemReferenceHash: number;
  itemId: string;
  transferToVault: boolean;
  characterId: string;
}) => apiPost("/api/d2/transfer", p);

export const equipItems = (p: { itemIds: string[]; characterId: string }) =>
  apiPost<{
    ok: boolean;
    results: { itemInstanceId: string; equipStatus: number }[];
  }>("/api/d2/equip", p);

export const insertPlug = (p: {
  itemId: string;
  characterId: string;
  socketIndex: number;
  plugItemHash: number;
}) => apiPost("/api/d2/insert-plug", p);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ItemLocation {
  /** null = coffre */
  characterId: string | null;
  equipped: boolean;
  postmaster: boolean;
}

/** Localise chaque instance : coffre, personnage, équipé, maître des postes. */
export function buildLocationMap(
  profile: ProfileResponse
): Map<string, ItemLocation> {
  const map = new Map<string, ItemLocation>();
  for (const item of profile.profileInventory?.data?.items ?? []) {
    if (item.itemInstanceId) {
      map.set(item.itemInstanceId, {
        characterId: null,
        equipped: false,
        postmaster: false,
      });
    }
  }
  for (const [charId, inv] of Object.entries(
    profile.characterInventories?.data ?? {}
  )) {
    for (const item of inv.items) {
      if (item.itemInstanceId) {
        map.set(item.itemInstanceId, {
          characterId: charId,
          equipped: false,
          postmaster: item.bucketHash === BUCKET_POSTMASTER,
        });
      }
    }
  }
  for (const [charId, inv] of Object.entries(
    profile.characterEquipment?.data ?? {}
  )) {
    for (const item of inv.items) {
      if (item.itemInstanceId) {
        map.set(item.itemInstanceId, {
          characterId: charId,
          equipped: true,
          postmaster: false,
        });
      }
    }
  }
  return map;
}

/** Amène un objet sur le personnage cible (via le coffre si besoin). */
export async function moveToCharacter(opts: {
  instanceId: string;
  itemHash: number;
  name: string;
  targetCharId: string;
  location: ItemLocation | undefined;
  log: (m: string) => void;
}): Promise<boolean> {
  const { instanceId, itemHash, name, targetCharId, location, log } = opts;
  if (!location) {
    log(`⚠️ ${name} : introuvable dans l'inventaire (supprimé ?)`);
    return false;
  }
  if (location.postmaster) {
    log(`⚠️ ${name} : au maître des postes — récupère-le d'abord en jeu`);
    return false;
  }
  if (location.characterId === targetCharId) return true;
  if (location.characterId && location.equipped) {
    log(`⚠️ ${name} : équipé sur un autre personnage — déséquipe-le d'abord`);
    return false;
  }
  try {
    if (location.characterId) {
      await transferItem({
        itemReferenceHash: itemHash,
        itemId: instanceId,
        transferToVault: true,
        characterId: location.characterId,
      });
      await sleep(150);
    }
    await transferItem({
      itemReferenceHash: itemHash,
      itemId: instanceId,
      transferToVault: false,
      characterId: targetCharId,
    });
    await sleep(150);
    return true;
  } catch (e) {
    log(`❌ ${name} : ${e instanceof Error ? e.message : "transfert impossible"}`);
    return false;
  }
}

export interface StatModSocket {
  socketIndex: number;
  /** statHash → plugItemHash du mod +10 correspondant */
  byStat: Map<number, number>;
}

/**
 * Trouve l'emplacement de mod de stats d'une armure et les plugs +10
 * disponibles, en lisant les plug sets du manifest (aucun hash codé en dur).
 */
export function findStatModSocket(
  defs: Defs,
  itemHash: number
): StatModSocket | null {
  const def = defs.items[itemHash];
  const entries = def?.sockets?.socketEntries ?? [];
  for (let index = 0; index < entries.length; index++) {
    const plugSetHash =
      entries[index].reusablePlugSetHash ?? entries[index].randomizedPlugSetHash;
    if (!plugSetHash) continue;
    const set = defs.plugSets[plugSetHash];
    const byStat = new Map<number, number>();
    for (const p of set?.reusablePlugItems ?? []) {
      const plugDef = defs.items[p.plugItemHash];
      const category = plugDef?.plug?.plugCategoryIdentifier ?? "";
      if (!category.startsWith("enhancements.")) continue;
      const inv = plugDef?.investmentStats ?? [];
      if (inv.length !== 1) continue;
      const stat = inv[0];
      if (stat.value === 10 && ARMOR_STAT_HASHES.includes(stat.statTypeHash)) {
        if (!byStat.has(stat.statTypeHash)) {
          byStat.set(stat.statTypeHash, p.plugItemHash);
        }
      }
    }
    if (byStat.size >= 3) return { socketIndex: index, byStat };
  }
  return null;
}
