export const BUNGIE_ROOT = "https://www.bungie.net";

/** Bucket "Poursuites" (quêtes + primes) */
export const BUCKET_PURSUITS = 1345459588;

/** Buckets d'armure, dans l'ordre d'affichage */
export const ARMOR_BUCKETS: Record<number, string> = {
  3448274439: "Casque",
  3551918588: "Gants",
  14239492: "Torse",
  20886954: "Jambes",
  1585787867: "Objet de classe",
};

export const ARMOR_SLOT_ORDER = [
  3448274439, 3551918588, 14239492, 20886954, 1585787867,
];

/** Buckets d'armes */
export const WEAPON_BUCKETS: Record<number, string> = {
  1498876634: "Cinétique",
  2465295065: "Énergétique",
  953998645: "Lourde",
};

export const WEAPON_SLOT_ORDER = [1498876634, 2465295065, 953998645];

/**
 * Hashs des 6 stats d'armure. Les hashs sont stables dans le temps :
 * seuls les noms changent (Armure 3.0), et on les lit dans le manifest.
 */
export const ARMOR_STAT_HASHES = [
  2996146975, // Armes (ex-Mobilité)
  392767087, // Santé (ex-Résilience)
  1943323491, // Classe (ex-Récupération)
  1735777505, // Grenade (ex-Discipline)
  144602215, // Super (ex-Intelligence)
  4244567218, // Mêlée (ex-Force)
];

/** Plafond par stat (Armure 3.0) */
export const STAT_CAP = 200;

export const CLASS_NAMES: Record<number, string> = {
  0: "Titan",
  1: "Chasseur",
  2: "Arcaniste",
};

/** Bucket sous-classe */
export const BUCKET_SUBCLASS = 3284755031;
/** Bucket maître des postes */
export const BUCKET_POSTMASTER = 215593132;

// DestinyItemType (sous-ensemble utile)
export const ITEM_TYPE_ARMOR = 2;
export const ITEM_TYPE_WEAPON = 3;
export const ITEM_TYPE_SUBCLASS = 16;
export const ITEM_TYPE_QUEST_STEP = 12;
export const ITEM_TYPE_QUEST = 15;
export const ITEM_TYPE_BOUNTY = 26;

// TierType
export const TIER_EXOTIC = 6;

// Catégories de sockets (DestinySocketCategoryDefinition)
export const SOCKET_CATEGORY_WEAPON_PERKS = 4241085061;
export const SOCKET_CATEGORY_WEAPON_MODS = 2685412949;

// DestinyRecordState (flags)
export const RECORD_STATE_REDEEMED = 1;
export const RECORD_STATE_OBJECTIVE_NOT_COMPLETED = 4;
