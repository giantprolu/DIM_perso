import { BUNGIE_ROOT } from "./destiny-constants";
import type { Defs } from "./types";

/**
 * Chargement du manifest Destiny 2 côté navigateur.
 * - La version + les chemins passent par notre proxy (/api/bungie/manifest)
 *   pour ne pas exposer l'API key.
 * - Les tables JSON (dont DestinyInventoryItemDefinition, ~100 Mo) sont
 *   téléchargées directement depuis le CDN Bungie puis mises en cache
 *   dans IndexedDB, invalidé quand la version du manifest change.
 */

const DB_NAME = "d2defs";
const STORE = "tables";
const VERSION_KEY = "__version__";

const TABLES = [
  "DestinyInventoryItemDefinition",
  "DestinyObjectiveDefinition",
  "DestinyStatDefinition",
  "DestinyClassDefinition",
  "DestinyInventoryBucketDefinition",
] as const;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let memoryCache: Defs | null = null;

export async function loadDefs(onProgress: (msg: string) => void): Promise<Defs> {
  if (memoryCache) return memoryCache;

  onProgress("Vérification du manifest Destiny 2…");
  const metaRes = await fetch("/api/bungie/manifest");
  const meta = (await metaRes.json().catch(() => null)) as
    | { version: string; paths: Record<string, string> }
    | { error: string }
    | null;
  if (!metaRes.ok || !meta || "error" in meta) {
    throw new Error(
      (meta && "error" in meta && meta.error) ||
        "Impossible de récupérer le manifest (BUNGIE_API_KEY configurée ?)"
    );
  }

  const db = await openDb();
  try {
    const storedVersion = await idbGet<string>(db, VERSION_KEY);
    if (storedVersion !== meta.version) {
      onProgress("Nouvelle version du manifest, purge du cache…");
      await idbClear(db);
      await idbSet(db, VERSION_KEY, meta.version);
    }

    const tables: Record<string, unknown> = {};
    for (let i = 0; i < TABLES.length; i++) {
      const table = TABLES[i];
      const shortName = table.replace("Destiny", "").replace("Definition", "");
      let data = await idbGet<unknown>(db, table);
      if (!data) {
        onProgress(
          `Téléchargement des définitions (${i + 1}/${TABLES.length}) : ${shortName}… (long la première fois)`
        );
        const res = await fetch(`${BUNGIE_ROOT}${meta.paths[table]}`);
        if (!res.ok) throw new Error(`Téléchargement échoué : ${table}`);
        data = await res.json();
        await idbSet(db, table, data);
      } else {
        onProgress(`Lecture du cache (${i + 1}/${TABLES.length}) : ${shortName}…`);
      }
      tables[table] = data;
    }

    memoryCache = {
      items: tables["DestinyInventoryItemDefinition"],
      objectives: tables["DestinyObjectiveDefinition"],
      stats: tables["DestinyStatDefinition"],
      classes: tables["DestinyClassDefinition"],
      buckets: tables["DestinyInventoryBucketDefinition"],
    } as Defs;
    return memoryCache;
  } finally {
    db.close();
  }
}
