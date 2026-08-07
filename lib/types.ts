/** Types pragmatiques (sous-ensemble de l'API Bungie réellement utilisé). */

export interface DisplayProperties {
  name: string;
  description: string;
  icon?: string;
  hasIcon?: boolean;
}

export interface ItemDef {
  hash: number;
  displayProperties: DisplayProperties;
  itemType: number;
  itemTypeDisplayName?: string;
  classType: number; // 0 Titan, 1 Chasseur, 2 Arcaniste, 3 Tous
  inventory?: {
    bucketTypeHash: number;
    tierType: number;
    tierTypeName?: string;
  };
  defaultDamageTypeHash?: number;
  setData?: {
    itemList?: { itemHash: number }[];
    questLineName?: string;
  };
  objectives?: { objectiveHashes?: number[] };
  plug?: { plugCategoryIdentifier?: string };
  investmentStats?: { statTypeHash: number; value: number }[];
  sockets?: {
    socketCategories?: { socketCategoryHash: number; socketIndexes: number[] }[];
  };
  redacted?: boolean;
}

export interface ObjectiveDef {
  hash: number;
  progressDescription?: string;
  completionValue?: number;
}

export interface StatDef {
  hash: number;
  displayProperties: DisplayProperties;
  index?: number;
}

export interface ClassDef {
  hash: number;
  displayProperties: DisplayProperties;
  classType: number;
}

export interface BucketDef {
  hash: number;
  displayProperties: DisplayProperties;
}

export interface DamageTypeDef {
  hash: number;
  displayProperties: DisplayProperties;
}

export interface RecordDef {
  hash: number;
  displayProperties: DisplayProperties;
  redacted?: boolean;
}

export interface PresentationNodeDef {
  hash: number;
  displayProperties: DisplayProperties;
  children?: {
    presentationNodes?: { presentationNodeHash: number }[];
    records?: { recordHash: number }[];
  };
  redacted?: boolean;
}

export interface SeasonDef {
  hash: number;
  displayProperties: DisplayProperties;
  seasonNumber?: number;
  seasonalChallengesPresentationNodeHash?: number;
}

export interface GuardianRankDef {
  hash: number;
  displayProperties: DisplayProperties;
  rankNumber: number;
  presentationNodeHash?: number;
}

export interface Defs {
  items: Record<string, ItemDef>;
  objectives: Record<string, ObjectiveDef>;
  stats: Record<string, StatDef>;
  classes: Record<string, ClassDef>;
  buckets: Record<string, BucketDef>;
  damageTypes: Record<string, DamageTypeDef>;
  records: Record<string, RecordDef>;
  nodes: Record<string, PresentationNodeDef>;
  seasons: Record<string, SeasonDef>;
  guardianRanks: Record<string, GuardianRankDef>;
}

// ---- Profil ----

export interface ProfileItem {
  itemHash: number;
  itemInstanceId?: string;
  bucketHash: number;
  quantity: number;
  state?: number;
  expirationDate?: string;
}

export interface ObjectiveProgress {
  objectiveHash: number;
  progress?: number;
  completionValue: number;
  complete: boolean;
  visible?: boolean;
}

export interface RecordComponent {
  state: number;
  objectives?: ObjectiveProgress[];
  intervalObjectives?: ObjectiveProgress[];
}

export interface Character {
  characterId: string;
  classType: number;
  classHash: number;
  light: number;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  dateLastPlayed: string;
}

export interface SocketState {
  plugHash?: number;
  isEnabled?: boolean;
  isVisible?: boolean;
}

export interface ProfileResponse {
  profile?: {
    data?: {
      currentSeasonHash?: number;
      currentGuardianRank?: number;
      lifetimeHighestGuardianRank?: number;
    };
  };
  characters?: { data?: Record<string, Character> };
  characterInventories?: { data?: Record<string, { items: ProfileItem[] }> };
  characterEquipment?: { data?: Record<string, { items: ProfileItem[] }> };
  profileInventory?: { data?: { items: ProfileItem[] } };
  profileRecords?: { data?: { records?: Record<string, RecordComponent> } };
  characterRecords?: {
    data?: Record<string, { records?: Record<string, RecordComponent> }>;
  };
  itemComponents?: {
    objectives?: {
      data?: Record<string, { objectives: ObjectiveProgress[] }>;
    };
    stats?: {
      data?: Record<
        string,
        { stats: Record<string, { statHash: number; value: number }> }
      >;
    };
    instances?: {
      data?: Record<
        string,
        {
          primaryStat?: { value: number };
          damageTypeHash?: number;
          energy?: { energyCapacity: number };
        }
      >;
    };
    sockets?: {
      data?: Record<string, { sockets: SocketState[] }>;
    };
  };
  characterUninstancedItemComponents?: Record<
    string,
    { objectives?: { data?: Record<string, { objectives: ObjectiveProgress[] }> } }
  >;
}

export interface SessionInfo {
  loggedIn: boolean;
  displayName?: string;
}
