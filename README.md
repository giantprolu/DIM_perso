# DIM Perso

Compagnon Destiny 2 minimaliste, à usage personnel, dans l'esprit de
[Destiny Item Manager](https://destinyitemmanager.com/) mais réduit à
l'essentiel :

- **Quêtes & progression** — poursuites (quêtes, primes) de chaque
  personnage, **défis saisonniers** groupés par semaine et objectifs des
  **rangs de Gardien**, avec la progression détaillée de chaque objectif.
- **Armes** — tout l'arsenal (coffre + personnages + équipé) avec perks et
  mods équipés, filtrable par emplacement, élément, rareté et recherche
  (y compris par nom de perk).
- **Optimiseur d'armure** — à partir de ce que tu possèdes réellement,
  calcule les meilleures combinaisons casque / gants / torse / jambes /
  objet de classe selon tes priorités de stats : exotique verrouillé,
  minimums par stat, calcul sur **stats de base** (mods retirés) et
  **simulation de 5 mods de stats (+10)**. Un guide intégré explique chaque
  filtre.

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
   - **Scope** : coche au minimum la lecture de tes données Destiny
     (« Read your Destiny 2 information (Vault, Inventory, Vendors)… »).
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
  api/bungie/…      Proxys authentifiés (manifest, profil) — API key côté serveur
  quests/           Suivi des poursuites par personnage
  optimizer/        Optimiseur d'armure
lib/
  bungie-server.ts  Client Platform API + échange/refresh des tokens
  manifest-client.ts  Téléchargement + cache IndexedDB du manifest (fr)
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

## Limites connues & roadmap

- Stats de base = stats affichées moins les mods amovibles (catégories de
  plugs `enhancements.*`) ; le masterwork reste inclus. Approximation
  fidèle dans la quasi-totalité des cas.
- Bonus de set, archétypes et mods d'accord pas encore simulés dans le
  score.
- Pas de transfert d'objets ni de sauvegarde de loadouts (lecture seule).
- Manifest en français uniquement (constante à changer dans
  `lib/manifest-client.ts` si besoin).
