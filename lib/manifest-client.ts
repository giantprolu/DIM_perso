import { BUNGIE_ROOT } from "./destiny-constants";
import type { Defs } from "./types";

/**
 * Chargement du manifest Destiny 2 côté navigateur.
 * - La version + les chemins passent par notre proxy (/api/bungie/manifest)
 *   pour ne pas exposer l'API key.
 * - Les tables JSON sont téléchargées depuis le CDN Bungie puis mises en
 *   cache dans IndexedDB, invalidé quand la version du manifest OU la liste
 *   des tables attendues (schéma) change.
 */

const DB_NAME = "d2defs";
const STORE = "tables";
const VERSION_KEY = "__version__";
const SCHEMA_KEY = "__schema__";

const TABLES = [
  "DestinyInventoryItemDefinition",
  "DestinyObjectiveDefinition",
  "DestinyStatDefinition",
  "DestinyClassDefinition",
  "DestinyInventoryBucketDefinition",
  "DestinyDamageTypeDefinition",
  "DestinyRecordDefinition",
  "DestinyPresentationNodeDefinition",
  "DestinySeasonDefinition",
  "DestinyGuardianRankDefinition",
  "DestinyPlugSetDefinition",
  "DestinyLoadoutNameDefinition",
  "DestinyLoadoutIconDefinition",
  "DestinyLoadoutColorDefinition",
  "DestinyLoadoutConstantsDefinition",
] as const;

/** Change quand la liste des tables évolue → invalide les caches. */
const SCHEMA = TABLES.join("|");

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
    const req = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(value, key);
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

let memoryCache: { schema: string; defs: Defs } | null = null;

export async function loadDefs(onProgress: (msg: string) => void): Promise<Defs> {
  // Le cache mémoire peut survivre à un déploiement (onglet resté ouvert) :
  // on ne le réutilise que si son schéma correspond au code courant.
  if (memoryCache && memoryCache.schema === SCHEMA) return memoryCache.defs;
  memoryCache = null;

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
    const storedSchema = await idbGet<string>(db, SCHEMA_KEY);
    if (storedVersion !== meta.version || storedSchema !== SCHEMA) {
      onProgress("Mise à jour du manifest, purge du cache…");
      await idbClear(db);
      await idbSet(db, VERSION_KEY, meta.version);
      await idbSet(db, SCHEMA_KEY, SCHEMA);
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
        if (!meta.paths[table]) {
          throw new Error(`Table absente du manifest Bungie : ${table}`);
        }
        const res = await fetch(`${BUNGIE_ROOT}${meta.paths[table]}`);
        if (!res.ok) throw new Error(`Téléchargement échoué : ${table}`);
        data = await res.json();
        await idbSet(db, table, data);
      } else {
        onProgress(`Lecture du cache (${i + 1}/${TABLES.length}) : ${shortName}…`);
      }
      if (!data || typeof data !== "object") {
        throw new Error(
          `Table du manifest invalide (${table}) — recharge la page pour réinitialiser le cache.`
        );
      }
      tables[table] = data;
    }

    const defs = {
      items: tables["DestinyInventoryItemDefinition"],
      objectives: tables["DestinyObjectiveDefinition"],
      stats: tables["DestinyStatDefinition"],
      classes: tables["DestinyClassDefinition"],
      buckets: tables["DestinyInventoryBucketDefinition"],
      damageTypes: tables["DestinyDamageTypeDefinition"],
      records: tables["DestinyRecordDefinition"],
      nodes: tables["DestinyPresentationNodeDefinition"],
      seasons: tables["DestinySeasonDefinition"],
      guardianRanks: tables["DestinyGuardianRankDefinition"],
      plugSets: tables["DestinyPlugSetDefinition"],
      loadoutNames: tables["DestinyLoadoutNameDefinition"],
      loadoutIcons: tables["DestinyLoadoutIconDefinition"],
      loadoutColors: tables["DestinyLoadoutColorDefinition"],
      loadoutConstants: tables["DestinyLoadoutConstantsDefinition"],
    } as Defs;

    memoryCache = { schema: SCHEMA, defs };
    return defs;
  } finally {
    db.close();
  }
}
