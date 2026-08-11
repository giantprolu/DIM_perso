"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDefs } from "@/lib/manifest-client";
import {
  ARMOR_SLOT_ORDER,
  ARMOR_STAT_HASHES,
  BUNGIE_ROOT,
  CLASS_NAMES,
  WEAPON_SLOT_ORDER,
} from "@/lib/destiny-constants";
import {
  analyzeVendors,
  type VendorOffer,
  type VendorSummary,
} from "@/lib/vendor-engine";
import type {
  Character,
  Defs,
  ProfileResponse,
  VendorsResponse,
} from "@/lib/types";

type Phase = "loading" | "ready" | "unauth" | "error";

/**
 * Classes écrites en toutes lettres : Tailwind scanne le source et
 * purgerait un `badge-${tone}` construit dynamiquement.
 */
const TONE_CLASS = {
  primary: "badge badge-sm badge-primary",
  warning: "badge badge-sm badge-warning",
  info: "badge badge-sm badge-info",
  success: "badge badge-sm badge-success",
} as const;

function timeUntil(iso?: string): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "stock renouvelé";
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} j ${h % 24} h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `${h} h ${m.toString().padStart(2, "0")}` : `${m} min`;
}

export default function MarchandsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusMsg, setStatusMsg] = useState("Chargement…");
  const [error, setError] = useState("");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [vendorsData, setVendorsData] = useState<VendorsResponse | null>(null);
  const [selectedChar, setSelectedChar] = useState("");
  const [vendorFilter, setVendorFilter] = useState<number | "all">("all");
  const [onlyAffordable, setOnlyAffordable] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);

  const loadVendors = useCallback(async (characterId: string) => {
    setLoadingVendors(true);
    try {
      const res = await fetch(`/api/bungie/vendors?characterId=${characterId}`);
      const data = (await res.json()) as VendorsResponse;
      if (!res.ok) throw new Error(data.error ?? "Erreur marchands");
      setVendorsData(data);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Impossible de lire les marchands (Bungie limite parfois cet accès)."
      );
    } finally {
      setLoadingVendors(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadDefs((msg) => !cancelled && setStatusMsg(msg));
        if (cancelled) return;
        setDefs(d);
        setStatusMsg("Lecture de ton profil…");
        const res = await fetch("/api/bungie/profile?scope=vendorContext");
        if (res.status === 401) {
          setPhase("unauth");
          return;
        }
        const data = (await res.json()) as ProfileResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur profil");
        if (cancelled) return;
        setProfile(data);
        const chars = Object.values(data.characters?.data ?? {});
        chars.sort(
          (a, b) =>
            new Date(b.dateLastPlayed).getTime() -
            new Date(a.dateLastPlayed).getTime()
        );
        if (chars.length > 0) {
          setSelectedChar(chars[0].characterId);
          setPhase("ready");
          setStatusMsg("Interrogation des marchands…");
          await loadVendors(chars[0].characterId);
        } else {
          setPhase("ready");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadVendors]);

  const characters: Character[] = useMemo(() => {
    const chars = Object.values(profile?.characters?.data ?? {});
    return chars.sort(
      (a, b) =>
        new Date(b.dateLastPlayed).getTime() -
        new Date(a.dateLastPlayed).getTime()
    );
  }, [profile]);

  const currentChar = characters.find((c) => c.characterId === selectedChar);

  /** Puissance d'équipement actuelle, pour juger les objets « au-dessus ». */
  const currentPower = useMemo(() => {
    if (!profile || !selectedChar) return 0;
    const equipped =
      profile.characterEquipment?.data?.[selectedChar]?.items ?? [];
    const instances = profile.itemComponents?.instances?.data ?? {};
    const gear = [...WEAPON_SLOT_ORDER, ...ARMOR_SLOT_ORDER];
    const powers = equipped
      .filter((i) => gear.includes(i.bucketHash) && i.itemInstanceId)
      .map((i) => instances[i.itemInstanceId!]?.primaryStat?.value ?? 0)
      .filter((p) => p > 0);
    if (powers.length === 0) return 0;
    return Math.floor(powers.reduce((a, v) => a + v, 0) / powers.length);
  }, [profile, selectedChar]);

  const analysis = useMemo(() => {
    if (!defs || !profile || !vendorsData || !currentChar) {
      return { offers: [] as VendorOffer[], vendors: [] as VendorSummary[] };
    }
    return analyzeVendors({
      defs,
      profile,
      vendorsData,
      classType: currentChar.classType,
      currentPower,
    });
  }, [defs, profile, vendorsData, currentChar, currentPower]);

  const shown = useMemo(() => {
    return analysis.offers.filter((o) => {
      if (vendorFilter !== "all" && o.vendorHash !== vendorFilter) return false;
      if (onlyAffordable && !o.affordable) return false;
      return true;
    });
  }, [analysis.offers, vendorFilter, onlyAffordable]);

  const highlights = shown.slice(0, 6);
  const rest = shown.slice(6);

  const statNames = useMemo(
    () =>
      ARMOR_STAT_HASHES.map(
        (h) => defs?.stats?.[h]?.displayProperties?.name ?? ""
      ),
    [defs]
  );

  async function switchCharacter(id: string) {
    setSelectedChar(id);
    setVendorsData(null);
    setVendorFilter("all");
    await loadVendors(id);
  }

  function OfferCard({ o, big }: { o: VendorOffer; big?: boolean }) {
    return (
      <div
        className={`card bg-base-200 shadow ${
          big ? "border border-primary/40" : ""
        }`}
      >
        <div className="card-body p-4 gap-2">
          <div className="flex items-start gap-3">
            {o.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={`item-icon${o.isExotic ? " exotic" : ""}`}
                src={`${BUNGIE_ROOT}${o.icon}`}
                alt=""
              />
            ) : (
              <div className="item-icon" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-tight">{o.name}</div>
              <div className="text-xs opacity-50">
                {o.typeName}
                {o.slotName ? ` · ${o.slotName}` : ""}
              </div>
            </div>
            {o.statTotal > 0 && (
              <div className="text-right">
                <div className="font-mono text-lg leading-none">
                  {o.statTotal}
                </div>
                <div className="text-[10px] opacity-50">stats</div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {o.reasons.map((r, i) => (
              <span key={i} className={TONE_CLASS[r.tone]}>
                {r.label}
              </span>
            ))}
          </div>

          {big && o.statTotal > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] opacity-70">
              {o.stats.map((v, i) =>
                v > 0 ? (
                  <span key={i}>
                    {statNames[i]} <span className="font-mono">{v}</span>
                  </span>
                ) : null
              )}
            </div>
          )}

          <div className="divider my-0" />

          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <span className="flex items-center gap-1.5 opacity-70">
              {o.vendorIcon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${BUNGIE_ROOT}${o.vendorIcon}`}
                  alt=""
                  className="w-4 h-4 rounded"
                />
              )}
              <strong>{o.vendorName}</strong>
              <span className="opacity-60">📍 {o.location}</span>
            </span>
            <span className="flex items-center gap-2">
              {o.costs.map((c) => (
                <span
                  key={c.itemHash}
                  className={`flex items-center gap-1 ${
                    c.affordable ? "" : "text-error"
                  }`}
                  title={`Tu possèdes ${c.owned}`}
                >
                  {c.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${BUNGIE_ROOT}${c.icon}`}
                      alt=""
                      className="w-4 h-4"
                    />
                  )}
                  <span className="font-mono">{c.quantity}</span>
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 opacity-70">
        <span className="loading loading-spinner loading-lg text-primary" />
        <div className="text-sm">{statusMsg}</div>
      </div>
    );
  }
  if (phase === "unauth") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="opacity-70">Connecte-toi pour voir les marchands.</p>
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div role="alert" className="alert alert-error">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Marchands</h1>
        <span className="badge badge-ghost">
          {shown.length} offres retenues
        </span>
      </div>

      <p className="text-sm opacity-70 max-w-3xl">
        Pas un catalogue : uniquement ce qui mérite ton attention aujourd&apos;hui
        — exotiques que tu n&apos;as jamais obtenus, armures qui battent les
        tiennes, objets au-dessus de ta puissance — avec le lieu où trouver le
        marchand et ce que ça te coûte.
      </p>

      <div className="flex gap-2.5 flex-wrap">
        {characters.map((c) => (
          <button
            key={c.characterId}
            className={`char-btn${selectedChar === c.characterId ? " active" : ""}`}
            style={
              c.emblemBackgroundPath
                ? {
                    backgroundImage: `url(${BUNGIE_ROOT}${c.emblemBackgroundPath})`,
                  }
                : undefined
            }
            onClick={() => switchCharacter(c.characterId)}
          >
            <div className="char-class">
              {CLASS_NAMES[c.classType] ?? "Gardien"}
            </div>
            <div className="char-light">✦ {c.light}</div>
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="alert alert-warning text-sm">
          <span>{error}</span>
        </div>
      )}

      {loadingVendors ? (
        <div className="flex flex-col items-center gap-3 py-12 opacity-70">
          <span className="loading loading-spinner loading-lg text-primary" />
          <div className="text-sm">Interrogation des marchands…</div>
        </div>
      ) : (
        <>
          {/* ── Marchands du moment ── */}
          {analysis.vendors.length > 0 && (
            <div className="flex gap-2 flex-wrap items-center">
              <button
                className={`btn btn-xs ${
                  vendorFilter === "all" ? "btn-primary" : "btn-outline"
                }`}
                onClick={() => setVendorFilter("all")}
              >
                Tous
              </button>
              {analysis.vendors.map((v) => (
                <button
                  key={v.hash}
                  className={`btn btn-xs gap-1 ${
                    vendorFilter === v.hash ? "btn-primary" : "btn-outline"
                  }`}
                  title={`${v.location}${
                    timeUntil(v.refreshDate)
                      ? ` — rotation dans ${timeUntil(v.refreshDate)}`
                      : ""
                  }`}
                  onClick={() => setVendorFilter(v.hash)}
                >
                  {v.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${BUNGIE_ROOT}${v.icon}`}
                      alt=""
                      className="w-4 h-4 rounded"
                    />
                  )}
                  {v.name}
                  <span className="badge badge-xs">{v.offerCount}</span>
                </button>
              ))}
              <label className="label cursor-pointer gap-2 py-0 ml-auto">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={onlyAffordable}
                  onChange={(e) => setOnlyAffordable(e.target.checked)}
                />
                <span className="label-text text-sm">
                  Seulement ce que je peux payer
                </span>
              </label>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="opacity-60 py-10 text-center">
              Rien de marquant chez les marchands pour ce personnage en ce
              moment. Repasse après une rotation.
            </div>
          ) : (
            <>
              <div className="divider divider-start text-sm uppercase tracking-wider opacity-70">
                <span className="whitespace-nowrap">⭐ À ne pas manquer</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {highlights.map((o) => (
                  <OfferCard key={o.key} o={o} big />
                ))}
              </div>

              {rest.length > 0 && (
                <>
                  <div className="divider divider-start text-sm uppercase tracking-wider opacity-70">
                    <span className="whitespace-nowrap">
                      Autres offres notables ({rest.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {rest.map((o) => (
                      <OfferCard key={o.key} o={o} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {analysis.vendors.length > 0 && (
            <div className="card bg-base-200 shadow">
              <div className="card-body p-4">
                <h2 className="card-title text-sm">Où et jusqu&apos;à quand</h2>
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <tbody>
                      {analysis.vendors.map((v) => (
                        <tr key={v.hash}>
                          <td className="w-8">
                            {v.icon && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`${BUNGIE_ROOT}${v.icon}`}
                                alt=""
                                className="w-6 h-6 rounded"
                              />
                            )}
                          </td>
                          <td className="font-medium">{v.name}</td>
                          <td className="text-xs opacity-70">📍 {v.location}</td>
                          <td className="text-xs opacity-50 text-right">
                            {timeUntil(v.refreshDate)
                              ? `rotation dans ${timeUntil(v.refreshDate)}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-xs opacity-50">
        L&apos;analyse compare le stock à <em>tes</em> collections, tes armures
        et ta puissance. Les achats se font en jeu : l&apos;API Bungie ne permet
        pas d&apos;acheter à distance.
      </p>
    </div>
  );
}
