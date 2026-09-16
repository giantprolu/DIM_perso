"use client";

import { useSyncExternalStore } from "react";

/**
 * Suit une media query CSS.
 *
 * Le serveur ne connaît pas l'écran : il répond `false`, et le client corrige
 * dès l'hydratation. Les pages passent de toute façon par un écran de
 * chargement avant d'afficher ce qui dépend de la largeur.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/**
 * Vrai quand l'appareil sait survoler (souris, pavé tactile).
 *
 * Sur un écran tactile, un survol n'existe pas : ce qui s'ouvre au passage de
 * la souris doit s'ouvrir au toucher, et les aperçus flottants n'ont rien à
 * faire là — le doigt les déclencherait sans jamais pouvoir les refermer.
 */
export function useCanHover(): boolean {
  return useMediaQuery("(hover: hover)");
}

/** Vrai à partir du point de rupture `lg` de Tailwind (1024 px). */
export function useIsWide(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
