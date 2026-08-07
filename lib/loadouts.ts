/**
 * Loadouts côté application, stockés dans le navigateur (localStorage).
 * Un loadout = armes + armures + sous-classe équipées, avec les plugs
 * (mods d'armure, mods d'arme, aspects/fragments) à restaurer.
 */

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
