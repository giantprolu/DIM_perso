# DIM Perso

Compagnon Destiny 2 minimaliste, à usage personnel, dans l'esprit de
[Destiny Item Manager](https://destinyitemmanager.com/) mais réduit à
l'essentiel :

- **Cette semaine** — les **jalons** de chaque personnage tels que le jeu les
  connaît : activités hebdomadaires, défis en cours, coffre déjà pris ou non,
  et le temps restant avant le reset. Plus la **rotation publique** (activités
  du moment et leurs **modificateurs**), tes **réputations** avec la
  progression vers le prochain rang, et le niveau de l'**artefact saisonnier**
  avec son bonus de puissance.
- **Quêtes & progression** — poursuites (quêtes, primes) de chaque
  personnage, **défis saisonniers** groupés par semaine et objectifs des
  **rangs de Gardien**, avec la progression détaillée de chaque objectif.
- **Activité** — tes dernières parties (filtrables par mode), chacune ouvrant
  le **rapport de fin de partie** complet : tous les joueurs, leur classe, leur
  puissance, leur score et leur K/D. Plus tes **statistiques de carrière**, tes
  **armes les plus utilisées** et tes **complétions par activité** (raids
  terminés, meilleur temps…).
- **Armes** — tout l'arsenal (coffre + personnages + équipé) avec perks et
  mods équipés, filtrable par emplacement, élément, rareté et recherche
  (y compris par nom de perk).
- **Optimiseur d'armure** — à partir de ce que tu possèdes réellement,
  calcule les meilleures combinaisons casque / gants / torse / jambes /
  objet de classe selon tes priorités de stats : exotique verrouillé,
  minimums par stat, calcul sur **stats de base** (mods retirés) et
  **simulation de 5 mods de stats (+10)**. Un guide intégré explique chaque
  filtre. Chaque build peut être **équipé en un clic** (transferts compris),
  avec pose automatique des mods suggérés.
- **Loadouts** — enregistre un personnage complet (armes, armures, mods,
  sous-classe avec aspects et fragments) puis réapplique-le : rapatriement
  des objets depuis le coffre ou les autres personnages, équipement,
  restauration des mods via `InsertSocketPlugFree`.
- **Loadouts en jeu (Lightfall)** — visualise les slots du personnage
  (icône, couleur, nom), équipe ou vide un slot, snapshot l'équipement
  actuel, ou pousse un loadout du site dans un slot (application puis
  `SnapshotLoadout`) : il apparaît directement dans le menu de personnage
  en jeu.
- **Clan** — le roster complet (toutes les pages, pas seulement les 50
  premiers), avec fiche détaillée au survol et au clic. Une **recherche par
  nom Bungie** (`Nom` ou `Nom#1234`) ouvre la même fiche pour n'importe quel
  Gardien, membre du clan ou non.
- **Actions en jeu** — équiper une arme ou l'envoyer au coffre directement
  depuis la page Armes.

Stack : **Next.js 15 (App Router) + TypeScript**, zéro dépendance superflue.
Le manifest Destiny 2 est mis en cache dans IndexedDB côté navigateur
(le premier chargement est long, ensuite c'est instantané).

## 1. Créer ton application Bungie (obligatoire)

1. Va sur <https://www.bungie.net/en/Application> (connecté à ton compte).
2. **Create New App**, puis :
   - **Application Name** : ce que tu veux (ex. `DIM Perso`).
   - **Website** : l'URL de ton déploiement (ex. `https://dim-perso.vercel.app`).
   - **OAuth Client Type** : **Confidential** (indispensable, on utilise un
     client secret côté serveur).
   - **Redirect URL** : `https://TON-APP.vercel.app/api/auth/callback`
     (remplace par ton URL Vercel réelle — doit correspondre exactement).
   - **Scope** : coche la lecture de tes données Destiny
     (« Read your Destiny 2 information (Vault, Inventory, Vendors)… »)
     **et** « Move or equip Destiny gear and other items » (indispensable
     pour équiper, transférer et poser des mods depuis le site). Si tu
     ajoutes ce scope après coup, déconnecte-toi puis reconnecte-toi sur le
     site pour re-consentir.
   - **Origin Header** : `https://TON-APP.vercel.app`.
3. Note les trois valeurs : **API Key**, **OAuth client_id**,
   **OAuth client_secret**.

> Bungie n'accepte qu'une seule Redirect URL par application. Pour développer
> en local, le plus simple est de créer une **seconde** application Bungie
> avec `https://localhost:3000/api/auth/callback` comme Redirect URL.

## 2. Variables d'environnement

Copie `.env.example` vers `.env.local` et remplis :

```
BUNGIE_API_KEY=...
BUNGIE_CLIENT_ID=...
BUNGIE_CLIENT_SECRET=...
```

Ces valeurs ne sont **jamais** exposées au navigateur : tous les appels
authentifiés passent par les routes `/api/*`, et les tokens OAuth vivent dans
des cookies `httpOnly`.

## 3. Développement local

```bash
npm install
npm run dev
```

Puis ouvre **https**://localhost:3000 (Bungie exige du HTTPS pour l'OAuth ;
`npm run dev` lance Next avec `--experimental-https`, accepte le certificat
auto-signé).

## 4. Déploiement sur Vercel

1. Importe ce repo dans Vercel (Add New → Project).
2. Ajoute les trois variables d'environnement (`BUNGIE_API_KEY`,
   `BUNGIE_CLIENT_ID`, `BUNGIE_CLIENT_SECRET`) dans
   *Settings → Environment Variables*.
3. Déploie, puis vérifie que la Redirect URL de ton app Bungie correspond
   bien à `https://TON-APP.vercel.app/api/auth/callback`.

## Architecture

```
app/
  api/auth/…        Flux OAuth Bungie (login, callback, logout, session)
  api/bungie/…      Proxys authentifiés — API key côté serveur
                    manifest · profile · weekly · activity · item ·
                    vendors · clan · player · search-player
  api/d2/…          Actions en jeu (équiper, transférer, mods, loadouts…)
  semaine/          Jalons, rotation publique, réputations, artefact
  quests/           Suivi des poursuites par personnage
  activite/         Historique, rapports de fin de partie, statistiques
  optimizer/        Optimiseur d'armure
lib/
  bungie-server.ts  Client Platform API : erreurs typées, rejeu, tokens
  auth-server.ts    Cookies de session + rafraîchissement des tokens
  manifest-client.ts  Téléchargement + cache IndexedDB du manifest (fr)
  weekly-engine.ts  Jalons, réputations et artefact → vues affichables
  activity-client.ts Historique et statistiques → lignes affichables
  string-variables.ts Substitution des « {var:…} » dans les libellés
  optimizer-engine.ts Énumération des combinaisons, poids, minimums, exotique
  destiny-constants.ts Hashs (buckets, stats, types d'objets)
```

Choix notables :

- Les **hashs de stats** sont stables côté Bungie ; les **noms** affichés
  viennent du manifest, donc les renommages (Armure 3.0…) sont absorbés
  automatiquement.
- Les objectifs de quêtes sont résolus pour les items **instanciés**
  (`itemComponents.objectives`) comme **non instanciés**
  (`characterUninstancedItemComponents`).
- Le moteur pré-trie chaque emplacement par score pondéré et tronque les
  candidats pour rester instantané, en conservant toujours l'exotique
  verrouillé.
- Les libellés Bungie contiennent des variables (`{var:1234}`) dont la valeur
  dépend du compte : le composant **StringVariables** est demandé avec le
  profil et `lib/string-variables.ts` les substitue, faute de quoi les
  objectifs s'afficheraient tels quels.
- Aucune liste de hashs codée en dur pour les jalons et les réputations : ils
  sont reconnus à leur forme (nom, icône de rang, paliers), pour que la page
  survive au changement de saison.
- Les erreurs Bungie sont typées (`BungieApiError`) : maintenance du mardi,
  limitation de débit et profil privé donnent des messages distincts, et les
  requêtes throttlées ou tombées sur une erreur serveur sont rejouées avec le
  délai que Bungie indique.
- Les refresh tokens Bungie sont à usage unique ; comme plusieurs requêtes
  partent en parallèle avec le même cookie, `bungie-server.ts` mutualise le
  renouvellement et garde le résultat une minute — sans quoi la session
  sautait au hasard.
- Vérifier une pose de mod passe par `GetItem` (une instance) plutôt que par
  une relecture du profil complet.

## Actions en jeu : bon à savoir

- L'équipement échoue dans certaines activités → mets-toi **en orbite** ou
  dans un espace social.
- Les objets **au maître des postes** ne sont pas transférables par l'API :
  ils sont signalés et ignorés.
- Un objet **équipé sur un autre personnage** ne peut pas être déplacé
  directement : équipe autre chose dessus d'abord.
- La pose de mods utilise `InsertSocketPlugFree` (plugs sans coût) ; si
  l'énergie de la pièce est insuffisante, Bungie refuse et l'erreur
  s'affiche dans le journal.

## Limites connues & roadmap

- Stats de base = stats affichées moins les mods amovibles (catégories de
  plugs `enhancements.*`) ; le masterwork reste inclus. Approximation
  fidèle dans la quasi-totalité des cas.
- Bonus de set, archétypes et mods d'accord pas encore simulés dans le
  score.
- Manifest en français uniquement (constante à changer dans
  `lib/manifest-client.ts` si besoin).
- Les statistiques de carrière dépendent de ce que Bungie accepte de
  renvoyer : `GetLeaderboards` est annoncé « not yet implemented » côté
  Bungie, et les endpoints `Fireteam/*` correspondent au LFG bungie.net
  historique, pas au Chercheur d'escouade en jeu.
- Pistes suivantes : catalyseurs et motifs d'armes façonnées (composants
  `ItemPlugObjectives` + `Craftables`), collections et triomphes
  (`PresentationNodes`), escouade en direct (`Transitory`).
