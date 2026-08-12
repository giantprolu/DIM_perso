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
  screenshot?: string;
  flavorText?: string;
  collectibleHash?: number;
  setData?: {
    itemList?: { itemHash: number }[];
    questLineName?: string;
  };
  objectives?: { objectiveHashes?: number[] };
  plug?: {
    plugCategoryIdentifier?: string;
    energyCost?: { energyCost: number; energyTypeHash?: number };
  };
  investmentStats?: {
    statTypeHash: number;
    value: number;
    isConditionallyActive?: boolean;
  }[];
  sockets?: {
    socketCategories?: { socketCategoryHash: number; socketIndexes: number[] }[];
    socketEntries?: {
      socketTypeHash?: number;
      singleInitialItemHash?: number;
      reusablePlugSetHash?: number;
      randomizedPlugSetHash?: number;
    }[];
  };
  redacted?: boolean;
}

export interface PlugSetDef {
  hash: number;
  reusablePlugItems?: { plugItemHash: number }[];
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

export interface LoadoutNameDef {
  hash: number;
  name?: string;
  index?: number;
}

export interface LoadoutIconDef {
  hash: number;
  iconImagePath?: string;
  index?: number;
}

export interface LoadoutColorDef {
  hash: number;
  colorImagePath?: string;
  index?: number;
}

export interface LoadoutConstantsDef {
  hash: number;
  loadoutCountPerCharacter?: number;
}

export interface VendorDef {
  hash: number;
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
    subtitle?: string;
    largeIcon?: string;
  };
  vendorPortrait?: string;
  vendorBanner?: string;
  enabled?: boolean;
  visible?: boolean;
  locations?: { destinationHash: number; backgroundImagePath?: string }[];
  displayItemHash?: number;
}

export interface DestinationDef {
  hash: number;
  displayProperties?: { name?: string; description?: string };
  placeHash?: number;
}

export interface PlaceDef {
  hash: number;
  displayProperties?: { name?: string };
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
  plugSets: Record<string, PlugSetDef>;
  loadoutNames: Record<string, LoadoutNameDef>;
  loadoutIcons: Record<string, LoadoutIconDef>;
  loadoutColors: Record<string, LoadoutColorDef>;
  loadoutConstants: Record<string, LoadoutConstantsDef>;
  vendors: Record<string, VendorDef>;
  destinations: Record<string, DestinationDef>;
  places: Record<string, PlaceDef>;
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
  /** Valeurs par hash de stat (les 6 stats d'armure + puissance) */
  stats?: Record<string, number>;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  dateLastPlayed: string;
}

export interface InGameLoadoutItem {
  itemInstanceId?: string;
  plugItemHashes?: number[];
}

export interface InGameLoadout {
  colorHash: number;
  iconHash: number;
  nameHash: number;
  items?: InGameLoadoutItem[];
}

export interface PlugSetsComponent {
  plugs?: Record<string, AvailablePlug[]>;
}

export interface ItemQuantity {
  itemHash: number;
  quantity: number;
}

export interface VendorSaleItem {
  vendorItemIndex: number;
  itemHash: number;
  quantity: number;
  saleStatus: number;
  costs?: ItemQuantity[];
  apiPurchasable?: boolean;
  overrideNextRefreshDate?: string;
}

export interface VendorComponent {
  vendorHash: number;
  vendorLocationIndex?: number;
  nextRefreshDate?: string;
  enabled?: boolean;
  canPurchase?: boolean;
  progression?: {
    progressionHash?: number;
    level?: number;
    progressToNextLevel?: number;
    nextLevelAt?: number;
  };
}

export interface VendorsResponse {
  vendors?: { data?: Record<string, VendorComponent> };
  sales?: {
    data?: Record<string, { saleItems?: Record<string, VendorSaleItem> }>;
  };
  itemComponents?: Record<
    string,
    {
      instances?: {
        data?: Record<
          string,
          {
            primaryStat?: { value: number };
            damageTypeHash?: number;
            energy?: { energyCapacity?: number; energyUsed?: number };
          }
        >;
      };
      stats?: {
        data?: Record<
          string,
          { stats?: Record<string, { statHash: number; value: number }> }
        >;
      };
      sockets?: { data?: Record<string, { sockets: SocketState[] }> };
    }
  >;
  error?: string;
}

export interface SocketState {
  plugHash?: number;
  isEnabled?: boolean;
  isVisible?: boolean;
}

/** Une option de mod proposée par Bungie pour un emplacement donné. */
export interface AvailablePlug {
  plugItemHash: number;
  canInsert?: boolean;
  enabled?: boolean;
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
  profileCollectibles?: {
    data?: { collectibles?: Record<string, { state: number }> };
  };
  profileCurrencies?: { data?: { items: ProfileItem[] } };
  /** Plugs débloqués au niveau du compte (livrés avec le composant 305) */
  profilePlugSets?: { data?: PlugSetsComponent };
  /** Plugs débloqués par personnage */
  characterPlugSets?: { data?: Record<string, PlugSetsComponent> };
  characterLoadouts?: {
    data?: Record<string, { loadouts?: InGameLoadout[] }>;
  };
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
    reusablePlugs?: {
      data?: Record<string, { plugs?: Record<string, AvailablePlug[]> }>;
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
