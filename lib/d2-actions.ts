import { BUCKET_POSTMASTER } from "./destiny-constants";
import type { ProfileResponse, SocketState } from "./types";

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

/** Résultat d'une pose de mod, tel que Bungie le renvoie dans la foulée. */
export interface InsertPlugResult {
  ok: boolean;
  /** true/false selon l'objet renvoyé par Bungie ; null s'il ne l'a pas renvoyé */
  applied: boolean | null;
  actualPlugHash: number | null;
  sockets: SocketState[] | null;
}

export const insertPlug = (p: {
  itemId: string;
  characterId: string;
  socketIndex: number;
  plugItemHash: number;
}) => apiPost<InsertPlugResult>("/api/d2/insert-plug", p);

/** Pointe (suit) ou dépointe une quête. */
export const setTracked = (p: {
  state: boolean;
  itemId: string;
  characterId: string;
}) => apiPost("/api/d2/item-state", { action: "track", ...p });

/** Verrouille ou déverrouille un objet. */
export const setLocked = (p: {
  state: boolean;
  itemId: string;
  characterId: string;
}) => apiPost("/api/d2/item-state", { action: "lock", ...p });

/** Récupère un objet au maître des postes. */
export const pullFromPostmaster = (p: {
  itemReferenceHash: number;
  itemId?: string;
  characterId: string;
  stackSize?: number;
}) => apiPost("/api/d2/postmaster", p);

export const loadoutAction = (p: {
  action: "snapshot" | "equip" | "clear" | "rename";
  loadoutIndex: number;
  characterId: string;
  colorHash?: number;
  iconHash?: number;
  nameHash?: number;
}) => apiPost("/api/d2/loadout", p);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lit le profil sans jamais passer par un cache.
 *
 * Juste après une écriture (équipement, mod posé), un `fetch` ordinaire peut
 * resservir la réponse précédente : on relisait alors l'ancien état et on
 * concluait à tort « non posé en jeu ».
 */
export async function fetchProfileFresh(
  scope: string
): Promise<ProfileResponse> {
  const res = await fetch(`/api/bungie/profile?scope=${scope}&t=${Date.now()}`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | (ProfileResponse & { error?: string })
    | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `profil illisible (HTTP ${res.status})`);
  }
  return json;
}

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
