"use client";

import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";

const ERRORS: Record<string, string> = {
  oauth_state:
    "La vérification de sécurité OAuth a échoué (state invalide). Réessaie de te connecter.",
  oauth_exchange:
    "L'échange du code OAuth a échoué. Vérifie BUNGIE_CLIENT_ID / BUNGIE_CLIENT_SECRET et la Redirect URL de ton app Bungie.",
};

const CARDS = [
  {
    href: "/quests",
    title: "Quêtes & progression",
    desc: "Poursuites, défis saisonniers et rangs de Gardien, avec la progression de chaque objectif.",
  },
  {
    href: "/armes",
    title: "Armes",
    desc: "Tout ton arsenal avec perks et mods équipés — filtre, équipe, transfère.",
  },
  {
    href: "/optimizer",
    title: "Optimiseur d'armure",
    desc: "Les meilleurs assemblages selon tes priorités, équipables en un clic.",
  },
  {
    href: "/loadouts",
    title: "Loadouts",
    desc: "Enregistre un personnage complet (armes, armure, mods, sous-classe) et réapplique-le.",
  },
];

export default function HomePage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(ERRORS[code] ?? "Erreur inconnue.");
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ loggedIn: false }));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="hero py-12">
        <div className="hero-content text-center flex-col">
          <h1 className="text-4xl font-semibold tracking-widest uppercase">
            DIM Perso
          </h1>
          <p className="max-w-xl opacity-70">
            Ton armurerie Destiny 2 personnelle : quêtes, arsenal, meilleurs
            assemblages d&apos;armure et loadouts complets — branchée en direct
            sur ton compte Bungie.
          </p>
          {session !== null && !session.loggedIn && (
            <a className="btn btn-primary" href="/api/auth/login">
              Se connecter avec Bungie.net
            </a>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      {session === null ? (
        <div className="flex justify-center py-10">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      ) : session.loggedIn ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CARDS.map((c) => (
            <a
              key={c.href}
              href={c.href}
              className="card bg-base-200 shadow hover:border-primary border border-base-300 transition-colors"
            >
              <div className="card-body">
                <h2 className="card-title text-primary">{c.title}</h2>
                <p className="text-sm opacity-70">{c.desc}</p>
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
