import { BUCKET_POSTMASTER } from "./destiny-constants";
import type {
  ItemResponse,
  ProfileItem,
  ProfileResponse,
  SocketState,
} from "./types";

/**
 * Erreur d'une de nos routes, statut HTTP compris : sans lui, l'appelant ne
 * peut pas distinguer « session expirée » d'une vraie panne.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

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
    throw new ApiError(json?.error ?? `HTTP ${res.status}`, res.status);
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
    throw new ApiError(
      json?.error ?? `profil illisible (HTTP ${res.status})`,
      res.status
    );
  }
  return json;
}

/**
 * Emplacements d'UNE instance, sans relire tout le profil.
 *
 * Vérifier une pose de mod ne demande que les sockets d'un objet : passer par
 * le profil complet coûtait plusieurs mégaoctets pour lire six cases.
 */
export async function fetchItemSockets(
  instanceId: string
): Promise<SocketState[]> {
  const res = await fetch(`/api/bungie/item?id=${instanceId}&t=${Date.now()}`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | (ItemResponse & { error?: string })
    | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `objet illisible (HTTP ${res.status})`);
  }
  return json.sockets?.data?.sockets ?? [];
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

// ---------------------------------------------------------------------------
// Mise à jour locale du profil
// ---------------------------------------------------------------------------

/*
 * Après une écriture, Bungie met plusieurs secondes à servir le nouvel état :
 * `GetProfile` renvoie encore l'ancienne arme équipée ou l'ancien mod, et
 * l'écran semblait figé jusqu'à ce qu'on recharge la page à la main.
 *
 * On applique donc le changement au profil déjà en mémoire — l'action a été
 * confirmée par Bungie, on sait ce qu'elle a produit — puis on relit le profil
 * en arrière-plan. Si la relecture est encore en retard, on lui réapplique le
 * changement plutôt que de revenir en arrière sous les yeux du joueur.
 */

/** Copie superficielle des seuls niveaux qu'on va modifier. */
function cloneInventories(profile: ProfileResponse): ProfileResponse {
  const next: ProfileResponse = { ...profile };
  if (profile.characterEquipment?.data) {
    next.characterEquipment = {
      ...profile.characterEquipment,
      data: Object.fromEntries(
        Object.entries(profile.characterEquipment.data).map(([id, inv]) => [
          id,
          { ...inv, items: [...inv.items] },
        ])
      ),
    };
  }
  if (profile.characterInventories?.data) {
    next.characterInventories = {
      ...profile.characterInventories,
      data: Object.fromEntries(
        Object.entries(profile.characterInventories.data).map(([id, inv]) => [
          id,
          { ...inv, items: [...inv.items] },
        ])
      ),
    };
  }
  if (profile.profileInventory?.data) {
    next.profileInventory = {
      ...profile.profileInventory,
      data: {
        ...profile.profileInventory.data,
        items: [...profile.profileInventory.data.items],
      },
    };
  }
  return next;
}

/** Instance actuellement portée dans cet emplacement, s'il y en a une. */
export function equippedInstance(
  profile: ProfileResponse,
  characterId: string,
  bucketHash: number
): string | undefined {
  const items = profile.characterEquipment?.data?.[characterId]?.items ?? [];
  return items.find((i) => i.bucketHash === bucketHash)?.itemInstanceId;
}

/**
 * Équipe un objet dans le profil en mémoire : il rejoint l'équipement du
 * personnage, et la pièce qu'il remplace retombe dans son inventaire — c'est
 * exactement ce que fait le jeu.
 */
export function applyEquipLocally(
  profile: ProfileResponse,
  opts: { characterId: string; instanceId: string; bucketHash: number }
): ProfileResponse {
  const { characterId, instanceId, bucketHash } = opts;
  const next = cloneInventories(profile);

  // 1. Retrouver l'objet et le retirer de là où il était.
  let moved: ProfileItem | undefined;
  const vault = next.profileInventory?.data;
  if (vault) {
    const i = vault.items.findIndex((it) => it.itemInstanceId === instanceId);
    if (i >= 0) moved = vault.items.splice(i, 1)[0];
  }
  for (const inv of Object.values(next.characterInventories?.data ?? {})) {
    if (moved) break;
    const i = inv.items.findIndex((it) => it.itemInstanceId === instanceId);
    if (i >= 0) moved = inv.items.splice(i, 1)[0];
  }
  for (const inv of Object.values(next.characterEquipment?.data ?? {})) {
    if (moved) break;
    const i = inv.items.findIndex((it) => it.itemInstanceId === instanceId);
    if (i >= 0) moved = inv.items.splice(i, 1)[0];
  }
  if (!moved) return profile;

  // 2. Déséquiper ce qui occupait l'emplacement.
  const gear = next.characterEquipment?.data?.[characterId];
  if (!gear) return profile;
  const previous = gear.items.findIndex((it) => it.bucketHash === bucketHash);
  if (previous >= 0) {
    const [old] = gear.items.splice(previous, 1);
    const bag = next.characterInventories?.data?.[characterId];
    if (bag) bag.items.push(old);
  }

  // 3. Poser le nouvel objet, dans le bucket de l'emplacement.
  gear.items.push({ ...moved, bucketHash });
  return next;
}

/** Remplace les emplacements d'une instance par ceux que Bungie vient de renvoyer. */
export function applySocketsLocally(
  profile: ProfileResponse,
  instanceId: string,
  sockets: SocketState[]
): ProfileResponse {
  const components = profile.itemComponents ?? {};
  return {
    ...profile,
    itemComponents: {
      ...components,
      sockets: {
        ...components.sockets,
        data: {
          ...(components.sockets?.data ?? {}),
          [instanceId]: { sockets },
        },
      },
    },
  };
}

/** Bascule un drapeau d'état (verrouillé, pointé) sur une instance. */
export function applyItemStateLocally(
  profile: ProfileResponse,
  instanceId: string,
  flag: number,
  on: boolean
): ProfileResponse {
  const next = cloneInventories(profile);
  const lists: ProfileItem[][] = [
    ...(next.profileInventory?.data ? [next.profileInventory.data.items] : []),
    ...Object.values(next.characterInventories?.data ?? {}).map((i) => i.items),
    ...Object.values(next.characterEquipment?.data ?? {}).map((i) => i.items),
  ];
  for (const items of lists) {
    const i = items.findIndex((it) => it.itemInstanceId === instanceId);
    if (i < 0) continue;
    const state = items[i].state ?? 0;
    items[i] = { ...items[i], state: on ? state | flag : state & ~flag };
    return next;
  }
  return profile;
}
