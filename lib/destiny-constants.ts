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

export const CLASS_NAMES: Record<number, string> = {
  0: "Titan",
  1: "Chasseur",
  2: "Arcaniste",
};

// DestinyItemType (sous-ensemble utile)
export const ITEM_TYPE_ARMOR = 2;
export const ITEM_TYPE_QUEST_STEP = 12;
export const ITEM_TYPE_QUEST = 15;
export const ITEM_TYPE_BOUNTY = 26;

// TierType
export const TIER_EXOTIC = 6;
