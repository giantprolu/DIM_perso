"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { BUNGIE_ROOT } from "@/lib/destiny-constants";
import { loadDefs } from "@/lib/manifest-client";
import {
  armorTotal,
  buildItemInfo,
  type ItemInfo,
  type ItemInstanceData,
} from "@/lib/item-info";
import type { Defs, ItemResponse } from "@/lib/types";

/**
 * Inspection d'objet, disponible sur tout le site.
 *
 * N'importe quelle icône, ligne ou vignette d'objet peut se déclarer
 * inspectable : le survol ouvre un aperçu, le clic la fiche complète. Les
 * pages n'ont rien à charger — le manifest est déjà en cache, et l'instance
 * (puissance, perks posés, chef-d'œuvre) est lue à la demande, une seule fois
 * par objet.
 */

export interface InspectTarget {
  itemHash: number;
  /** Exemplaire précis, quand l'objet est possédé */
  instanceId?: string;
  /** Ce que la page sait déjà : évite un aller-retour réseau */
  instance?: ItemInstanceData;
}

interface Anchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface InspectorApi {
  show: (target: InspectTarget, element: HTMLElement) => void;
  hide: () => void;
  pin: (target: InspectTarget) => void;
}

const InspectorContext = createContext<InspectorApi | null>(null);

const HOVER_DELAY_MS = 120;
const CARD_WIDTH = 320;

/**
 * Instances déjà lues. Le survol d'un tableau d'armes déclencherait sinon
 * une requête par aller-retour de la souris.
 */
const instanceCache = new Map<string, ItemInstanceData | null>();
const inflight = new Map<string, Promise<ItemInstanceData | null>>();

async function fetchInstance(
  instanceId: string
): Promise<ItemInstanceData | null> {
  if (instanceCache.has(instanceId)) return instanceCache.get(instanceId)!;
  const running = inflight.get(instanceId);
  if (running) return running;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/bungie/item?id=${instanceId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as ItemResponse;
      const data: ItemInstanceData = {
        primaryStat: json.instance?.data?.primaryStat?.value,
        damageTypeHash: json.instance?.data?.damageTypeHash,
        energyCapacity: json.instance?.data?.energy?.energyCapacity,
        energyUsed: json.instance?.data?.energy?.energyUsed,
        stats: json.stats?.data?.stats,
        sockets: json.sockets?.data?.sockets,
        state: json.item?.data?.state,
      };
      instanceCache.set(instanceId, data);
      return data;
    } catch {
      /*
       * Un objet d'un autre joueur, un objet vendu ou déjà démantelé : la
       * fiche du manifest reste utile, on ne signale donc pas d'erreur.
       */
      instanceCache.set(instanceId, null);
      return null;
    }
  })().finally(() => inflight.delete(instanceId));

  inflight.set(instanceId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Fournisseur
// ---------------------------------------------------------------------------

export function ItemInspectorProvider({ children }: { children: ReactNode }) {
  const [defs, setDefs] = useState<Defs | null>(null);
  const [hover, setHover] = useState<{
    target: InspectTarget;
    anchor: Anchor;
  } | null>(null);
  const [pinned, setPinned] = useState<InspectTarget | null>(null);
  /** Instance chargée pour l'objet en cours, indexée par instanceId. */
  const [loaded, setLoaded] = useState<Record<string, ItemInstanceData | null>>(
    {}
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defsRequested = useRef(false);

  /** Le manifest n'est chargé qu'au premier survol : rien à payer sinon. */
  const ensureDefs = useCallback(() => {
    if (defsRequested.current) return;
    defsRequested.current = true;
    loadDefs(() => {})
      .then(setDefs)
      .catch(() => {
        // Sans définitions il n'y a pas de fiche : on retentera au prochain survol.
        defsRequested.current = false;
      });
  }, []);

  const wantInstance = useCallback((target: InspectTarget) => {
    const id = target.instanceId;
    if (!id || target.instance) return;
    fetchInstance(id).then((data) =>
      setLoaded((prev) => (id in prev ? prev : { ...prev, [id]: data }))
    );
  }, []);

  const show = useCallback(
    (target: InspectTarget, element: HTMLElement) => {
      if (timer.current) clearTimeout(timer.current);
      ensureDefs();
      const rect = element.getBoundingClientRect();
      const anchor = {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
      timer.current = setTimeout(() => {
        setHover({ target, anchor });
        wantInstance(target);
      }, HOVER_DELAY_MS);
    },
    [ensureDefs, wantInstance]
  );

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHover(null);
  }, []);

  const pin = useCallback(
    (target: InspectTarget) => {
      if (timer.current) clearTimeout(timer.current);
      ensureDefs();
      setHover(null);
      setPinned(target);
      wantInstance(target);
    },
    [ensureDefs, wantInstance]
  );

  const api = useMemo<InspectorApi>(
    () => ({ show, hide, pin }),
    [show, hide, pin]
  );

  // Un défilement rend le point d'ancrage faux : mieux vaut fermer l'aperçu.
  useEffect(() => {
    if (!hover) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [hover, hide]);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function instanceOf(target: InspectTarget): ItemInstanceData | undefined {
    if (target.instance) return target.instance;
    if (!target.instanceId) return undefined;
    return loaded[target.instanceId] ?? undefined;
  }

  const hoverInfo =
    defs && hover ? buildItemInfo(defs, hover.target.itemHash, instanceOf(hover.target)) : null;
  const pinnedInfo =
    defs && pinned ? buildItemInfo(defs, pinned.itemHash, instanceOf(pinned)) : null;

  return (
    <InspectorContext.Provider value={api}>
      {children}

      {hover && (
        <HoverCard anchor={hover.anchor} info={hoverInfo} ready={Boolean(defs)} />
      )}

      {pinned && (
        <ItemModal
          info={pinnedInfo}
          ready={Boolean(defs)}
          onClose={() => setPinned(null)}
        />
      )}
    </InspectorContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Accroche : ce que les pages posent sur une icône ou une ligne
// ---------------------------------------------------------------------------

export interface InspectHandlers {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  className?: string;
}

/**
 * Rend un élément inspectable. À poser sur n'importe quoi qui représente un
 * objet :
 *
 *   <div {...inspect({ itemHash, instanceId })}>…</div>
 *
 * `clickable: false` conserve le clic de la page (équiper, sélectionner) et
 * ne garde que le survol.
 */
export function useInspectItem(): (
  target: InspectTarget | null | undefined,
  options?: { clickable?: boolean }
) => InspectHandlers | undefined {
  const api = useContext(InspectorContext);

  return useCallback(
    (target, options) => {
      if (!api || !target?.itemHash) return undefined;
      const clickable = options?.clickable !== false;
      return {
        onMouseEnter: (e) => api.show(target, e.currentTarget),
        onMouseLeave: api.hide,
        onFocus: (e) => api.show(target, e.currentTarget),
        onBlur: api.hide,
        onClick: clickable
          ? (e) => {
              e.stopPropagation();
              api.pin(target);
            }
          : undefined,
        className: clickable ? "cursor-pointer" : undefined,
      };
    },
    [api]
  );
}

// ---------------------------------------------------------------------------
// Aperçu au survol
// ---------------------------------------------------------------------------

function place(anchor: Anchor): { top: number; left: number } {
  if (typeof window === "undefined") {
    return { top: anchor.bottom, left: anchor.left };
  }
  const margin = 8;
  const estimatedHeight = 340;

  // À droite si la place existe, sinon à gauche, sinon collé au bord.
  let left = anchor.right + 10;
  if (left + CARD_WIDTH + margin > window.innerWidth) {
    left = anchor.left - CARD_WIDTH - 10;
  }
  left = Math.min(
    Math.max(margin, left),
    Math.max(margin, window.innerWidth - CARD_WIDTH - margin)
  );

  let top = anchor.top - 4;
  if (top + estimatedHeight + margin > window.innerHeight) {
    top = window.innerHeight - estimatedHeight - margin;
  }
  return { top: Math.max(margin, top), left };
}

function HoverCard({
  anchor,
  info,
  ready,
}: {
  anchor: Anchor;
  info: ItemInfo | null;
  ready: boolean;
}) {
  const [pos, setPos] = useState(() => place(anchor));
  useEffect(() => setPos(place(anchor)), [anchor]);

  return (
    <div
      role="tooltip"
      className="fixed pointer-events-none card bg-base-300 shadow-xl ring-1 ring-base-content/15 overflow-hidden"
      style={{ top: pos.top, left: pos.left, width: CARD_WIDTH, zIndex: 1200 }}
    >
      {info ? (
        <ItemInfoBody info={info} compact />
      ) : (
        <div className="p-3 text-xs opacity-60 flex items-center gap-2">
          {ready ? (
            "Objet inconnu du manifest."
          ) : (
            <>
              <span className="loading loading-spinner loading-xs" />
              Lecture des définitions…
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiche complète
// ---------------------------------------------------------------------------

function ItemModal({
  info,
  ready,
  onClose,
}: {
  info: ItemInfo | null;
  ready: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 1100 }}
    >
      <div className="modal-box max-w-2xl p-0 overflow-hidden">
        {info?.screenshot && (
          <div
            className="h-36 bg-cover bg-center"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(20,24,31,.2), rgba(20,24,31,.95)), url(${BUNGIE_ROOT}${info.screenshot})`,
            }}
          />
        )}
        <button
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          onClick={onClose}
          aria-label="Fermer"
        >
          ✕
        </button>
        {info ? (
          <div className="max-h-[70vh] overflow-y-auto">
            <ItemInfoBody info={info} compact={false} />
          </div>
        ) : (
          <div className="p-6 text-sm opacity-70 flex items-center gap-3">
            {ready ? (
              "Cet objet n'existe pas dans le manifest Destiny."
            ) : (
              <>
                <span className="loading loading-spinner" />
                Lecture des définitions…
              </>
            )}
          </div>
        )}
      </div>
      <div
        className="modal-backdrop bg-black/60"
        onClick={onClose}
        role="presentation"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contenu partagé par l'aperçu et la fiche
// ---------------------------------------------------------------------------

function PlugRow({
  plug,
  compact,
}: {
  plug: { name: string; icon?: string; description?: string };
  compact: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      {plug.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${BUNGIE_ROOT}${plug.icon}`}
          alt=""
          className="w-6 h-6 rounded bg-base-100/40 shrink-0"
        />
      ) : (
        <span className="w-6 h-6 rounded bg-base-100/40 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-xs leading-tight">{plug.name}</div>
        {!compact && plug.description && (
          <div className="text-[11px] opacity-55 leading-snug mt-0.5">
            {plug.description}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemInfoBody({
  info,
  compact,
}: {
  info: ItemInfo;
  compact: boolean;
}) {
  const total = info.isArmor ? armorTotal(info) : 0;
  const stats = compact ? info.stats.slice(0, 7) : info.stats;

  return (
    <div className={compact ? "p-3 flex flex-col gap-2" : "p-5 flex flex-col gap-4"}>
      <div className="flex items-start gap-2.5">
        {info.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${BUNGIE_ROOT}${info.icon}`}
            alt=""
            className={`rounded shrink-0 border ${
              info.isExotic ? "border-[#ceae33]" : "border-base-content/15"
            } ${compact ? "w-10 h-10" : "w-14 h-14"}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={`font-semibold leading-tight ${compact ? "text-sm" : "text-lg"}`}
          >
            {info.name}
          </div>
          <div className="text-[11px] opacity-60 truncate">
            {info.subtitle}
            {info.slotName && ` · ${info.slotName}`}
            {info.classLabel && ` · ${info.classLabel}`}
          </div>
        </div>
        {info.power > 0 && (
          <div className="text-right shrink-0">
            <div
              className={`font-mono text-[#ffd970] leading-none ${
                compact ? "text-lg" : "text-2xl"
              }`}
            >
              ✦ {info.power}
            </div>
            <div className="text-[10px] opacity-50">puissance</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        {info.damageIcon && (
          <span className="flex items-center gap-1 opacity-80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BUNGIE_ROOT}${info.damageIcon}`}
              alt=""
              className="w-3.5 h-3.5"
            />
            {info.damageName}
          </span>
        )}
        {info.ammoLabel && <span className="opacity-60">{info.ammoLabel}</span>}
        {info.energyCapacity > 0 && (
          <span className="opacity-60">
            énergie {info.energyUsed}/{info.energyCapacity}
          </span>
        )}
        {info.quantity !== undefined && info.quantity > 1 && (
          <span className="opacity-60">×{info.quantity}</span>
        )}
        {info.isExotic && (
          <span className="badge badge-xs badge-warning">exotique</span>
        )}
        {info.isMasterwork && (
          <span className="badge badge-xs badge-warning">chef-d&apos;œuvre</span>
        )}
        {info.isCrafted && (
          <span className="badge badge-xs badge-info">façonnée</span>
        )}
        {info.isLocked && <span className="badge badge-xs badge-ghost">🔒</span>}
      </div>

      {stats.length > 0 && (
        <div className="flex flex-col gap-1">
          {!compact && (
            <div className="text-xs uppercase tracking-wider opacity-50">
              Statistiques
            </div>
          )}
          {stats.map((s) => (
            <div key={s.hash} className="flex items-center gap-2">
              <span className="text-[11px] opacity-70 w-24 truncate">
                {s.name}
              </span>
              <progress
                className="progress progress-primary h-1 flex-1"
                value={Math.max(0, Math.min(s.value, s.max))}
                max={s.max}
              />
              <span className="text-[11px] font-mono w-8 text-right tabular-nums">
                {s.value}
              </span>
            </div>
          ))}
          {total > 0 && (
            <div className="text-[11px] opacity-60 text-right">
              Total : <span className="font-mono">{total}</span>
            </div>
          )}
        </div>
      )}

      {info.perks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider opacity-50">
            Perks
          </div>
          {info.perks.map((p) => (
            <PlugRow key={p.hash} plug={p} compact={compact} />
          ))}
        </div>
      )}

      {info.mods.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider opacity-50">
            Mods
          </div>
          {info.mods.map((m) => (
            <PlugRow key={m.hash} plug={m} compact={compact} />
          ))}
        </div>
      )}

      {!compact && info.description && (
        <p className="text-xs opacity-70 whitespace-pre-line">
          {info.description}
        </p>
      )}

      {info.flavorText && (
        <p
          className={`italic opacity-50 ${compact ? "text-[11px] line-clamp-2" : "text-xs"}`}
        >
          {info.flavorText}
        </p>
      )}

      {!info.hasInstance && (info.isWeapon || info.isArmor) && (
        <p className="text-[10px] opacity-40">
          Valeurs de base du manifest — un exemplaire réel peut différer.
        </p>
      )}

      {compact && (
        <p className="text-[10px] opacity-40">Clique pour la fiche complète</p>
      )}
    </div>
  );
}
