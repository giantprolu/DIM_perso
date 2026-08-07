"use client";

import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";

const ERRORS: Record<string, string> = {
  oauth_state:
    "La vérification de sécurité OAuth a échoué (state invalide). Réessaie de te connecter.",
  oauth_exchange:
    "L'échange du code OAuth a échoué. Vérifie BUNGIE_CLIENT_ID / BUNGIE_CLIENT_SECRET et la Redirect URL de ton app Bungie.",
};

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
    <div className="hero">
      <h1>DIM Perso</h1>
      <p>
        Ton compagnon Destiny 2 minimaliste : suivi des quêtes et primes de tes
        personnages, et calcul des meilleures combinaisons d&apos;armure à
        partir de ce que tu possèdes réellement.
      </p>

      {error && <div className="error-box">{error}</div>}

      {session === null ? (
        <div className="status">
          <div className="spinner" />
        </div>
      ) : session.loggedIn ? (
        <div className="home-cards">
          <a className="home-card" href="/quests">
            <h3>Quêtes &amp; progression</h3>
            <p>
              Poursuites, défis saisonniers et rangs de Gardien, avec la
              progression de chaque objectif.
            </p>
          </a>
          <a className="home-card" href="/armes">
            <h3>Armes</h3>
            <p>
              Tout ton arsenal avec perks et mods équipés, filtrable par
              emplacement, élément et rareté.
            </p>
          </a>
          <a className="home-card" href="/optimizer">
            <h3>Optimiseur d&apos;armure</h3>
            <p>
              Choisis un exotique et tes priorités de stats, le moteur trouve
              les meilleurs builds dans ton coffre.
            </p>
          </a>
        </div>
      ) : (
        <a className="btn btn-primary" href="/api/auth/login">
          Se connecter avec Bungie.net
        </a>
      )}
    </div>
  );
}
