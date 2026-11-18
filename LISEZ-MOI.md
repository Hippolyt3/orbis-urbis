# Orbis Urbis

Un globe 3D dans l'espace où les joueurs achètent les communes du monde (225 951 lieux de plus de 500 habitants, source GeoNames).

## Jouer en ligne

Le jeu est en ligne : **https://hippolyt3.github.io/orbis-urbis/**

Il est publié automatiquement par GitHub Pages depuis la branche `main` du dépôt https://github.com/Hippolyt3/orbis-urbis : chaque modification envoyée sur GitHub met le site à jour en une ou deux minutes.

Dans Supabase, **Authentication > URL Configuration** doit contenir l'adresse du site :
- **Site URL** : `https://hippolyt3.github.io/orbis-urbis/`
- **Redirect URLs** : `https://hippolyt3.github.io/orbis-urbis/` et `http://localhost:8770` (pour continuer à tester sur votre ordinateur)

## Lancer le jeu sur votre ordinateur

Double-cliquez sur **Lancer Orbis Urbis.command**. Le jeu s'ouvre dans votre navigateur à l'adresse http://localhost:8770.
La première fois, macOS peut bloquer le fichier : faites un clic droit dessus, choisissez **Ouvrir**, puis confirmez.

Ouvrir `index.html` directement ne fonctionne pas : le navigateur refuse alors de charger la liste des communes.

## Brancher Supabase (comptes, profils, multijoueur)

Sans Supabase, on peut explorer le globe mais pas acheter. Supabase est gratuit pour commencer.

1. Créez un compte sur https://supabase.com, puis un **nouveau projet** (notez le mot de passe de la base, il ne sert pas dans le jeu).
2. Dans le projet, ouvrez **SQL Editor > New query**, collez tout le contenu de `supabase/schema.sql`, puis cliquez sur **Run**. Cela crée les tables, les règles de sécurité et la fonction d'achat.
   Ensuite, toujours dans **SQL Editor**, exécutez de la même façon `supabase/02_pack_bienvenue.sql` (pack de bienvenue et prix vérifiés par le serveur).
   Exécutez aussi `supabase/03_vente.sql` (vente des communes), puis `supabase/04_ameliorations.sql` (améliorations) `supabase/05_defis.sql`, `supabase/06_defis_progressifs.sql` puis `supabase/07_defi_5min.sql` (défis), puis `supabase/08_coffres_evenements.sql` (coffres et événements) et `supabase/09_coffres_minute.sql` (un coffre par minute).
   Puis remplissez le catalogue des communes : **Table Editor > communes > Insert > Import data from CSV**, choisissez `supabase/communes.csv` (225 951 lignes, environ 9 Mo) et validez l'import.
3. Ouvrez **Project Settings > API** (ou **Data API**) et copiez :
   - l'**URL du projet** (`https://xxxx.supabase.co`),
   - la clé publique **anon** (ou **publishable**).
4. Collez-les dans `js/config.js`, dans `supabaseUrl` et `supabaseAnonKey`. N'y mettez jamais la clé `service_role` ou `secret`.
5. Dans **Authentication > URL Configuration**, mettez `http://localhost:8770` comme **Site URL** : c'est là que mènent les liens de confirmation et de mot de passe oublié.
6. Rechargez le jeu. Le statut en haut à gauche indique « En ligne » et le bouton en haut à droite propose de se connecter.

Par défaut, Supabase envoie un e-mail de confirmation à chaque inscription. Pour tester plus vite, vous pouvez le désactiver dans **Authentication > Sign In / Providers > Email > Confirm email**. Le service d'e-mail gratuit de Supabase est limité à quelques messages par heure : pour un vrai lancement, branchez votre propre service d'envoi (SMTP).

### Ce que fait Supabase

- **Comptes** : inscription avec pseudo, e-mail et mot de passe ; connexion ; mot de passe oublié.
- **Profil** (bouton en haut à droite) : trésor, revenu, nombre de communes, valeur de l'empire, classement, liste de vos communes. On peut y changer de pseudo et de mot de passe, se déconnecter ou supprimer son compte (ses communes sont alors libérées).
- **Multijoueur** : les achats et le classement sont partagés en direct entre tous les joueurs. Une commune achetée par quelqu'un d'autre devient rouge sur votre écran sans recharger la page.
- **Sécurité** : le trésor est calculé et vérifié par le serveur ; un joueur ne peut pas modifier son argent ni acheter une commune déjà prise.

## Pack de bienvenue

À sa première connexion, chaque joueur ouvre un pack qui lui offre **une commune libre**, tirée au sort par le serveur selon sa taille :

| Catégorie | Taille | Chance |
|---|---|---|
| Capitale | capitales des pays | 0,0001 % |
| Métropole | 1 million d'habitants et plus | 0,01 % |
| Grande ville | 100 000 à 1 million | 0,5 % |
| Ville | 20 000 à 100 000 | 4,4899 % |
| Petite ville | 5 000 à 20 000 | 20 % |
| Village | moins de 5 000 | 75 % |

Le tirage ne propose que des communes qui n'ont pas encore de propriétaire. Si toutes les communes de la catégorie tirée sont prises, il passe à la catégorie plus petite, puis à la plus grande. Chaque compte n'a droit qu'à un seul pack. S'il ferme la fenêtre, le joueur peut l'ouvrir plus tard depuis son profil.

Pour changer les chances, modifiez la ligne `odds` dans `supabase/02_pack_bienvenue.sql`, exécutez de nouveau le fichier, puis mettez à jour l'affichage (`TIERS` dans `js/game.js`).

## Améliorer une commune

Sur la fiche d'une commune qui vous appartient, **Améliorer** construit le bâtiment suivant et augmente son revenu :

| Niveau | Bâtiment | Revenu | Coût de l'amélioration |
|---|---|---|---|
| 1 | Commune | ×1 | (achat) |
| 2 | Marché | ×1,5 | 50 % du prix de la commune |
| 3 | Gare | ×2 | 100 % |
| 4 | Aéroport | ×3 | 200 % |
| 5 | Monument | ×5 | 400 % |

Le point vert grossit avec le niveau, et il a un contour doré au niveau 5. Les améliorations sont vérifiées par le serveur. Pour changer les chiffres, modifiez `supabase/04_ameliorations.sql` (fonctions `level_multiplier` et `upgrade_cost_ratio`) et `LEVELS` dans `js/game.js`.

## Défis

Le panneau **Défis** (sous le trésor) affiche deux défis, chacun à son étape du moment :

**Temps de jeu**, chaque jour : jouer **5 min d'affilée** (+100 ₵), puis **10 min** (+300 ₵), puis **30 min** (+1 000 ₵), puis **1 h** (+3 000 ₵). Une fois une étape réclamée, la suivante apparaît. Le défi repart de 5 min chaque jour à minuit (heure de Paris). C'est le serveur qui mesure le temps : le jeu lui envoie un signal chaque minute tant que le joueur bouge la souris, le clavier ou l'écran. Après 3 minutes d'inactivité, ou si le jeu est fermé ou caché, la série repart de zéro.

**Collection**, une seule fois par compte : posséder **1 commune** (+500 ₵), puis **2** (+1 000 ₵), puis **5** (+3 000 ₵), puis **10** (+10 000 ₵).

Pour changer les chiffres : `play_challenge` et `owned_challenge` dans les fichiers SQL, et `CHALLENGES` / `OWN_CHALLENGES` dans `js/game.js`.

## Coffres au trésor

Toutes les minutes, un coffre de 500 à 3 000 ₵ est caché dans une ville du monde. Le bandeau en bas de l'écran indique sa récompense, le pays et le temps restant, et un **cercle doré** d'environ 120 km apparaît sur le globe. **Chercher** emmène le joueur au-dessus du cercle et active la fouille : chaque clic dans le cercle donne un coup de pelle, et le serveur répond par la distance au coffre (froid, tiède, chaud, brûlant). Le premier joueur qui creuse à moins de 8 km du coffre gagne la récompense. L'emplacement exact n'est jamais envoyé aux joueurs, et le serveur impose 2 secondes entre deux coups de pelle.

## Événement de l'heure

Chaque heure, un pays est tiré au sort parmi 88 : ses communes coûtent **40 % de moins** à l'achat et à l'amélioration jusqu'à la fin de l'heure. Le bandeau bleu affiche le pays et le temps restant ; un clic dessus emmène le joueur dans ce pays. Les communes achetées pendant l'événement gardent leur revenu normal, calculé sur leur prix plein.

Pour changer les cachettes ou les pays : `python3 tools/build_chests_sql.py data/communes.txt supabase/08_coffres_evenements.sql`, puis exécutez de nouveau le fichier.

## Pendant ton absence

Quand un joueur revient après plus de 10 minutes, une fenêtre lui montre ce que ses communes ont rapporté pendant son absence, son trésor, et la prochaine amélioration à faire (ou combien de temps il faut encore attendre pour se l'offrir). Un bouton l'emmène directement à la commune concernée. La date de dernière visite est retenue par chaque navigateur.

## Vendre une commune

Sur la fiche d'une commune qui vous appartient, **Vendre** vous rend **la moitié de tout ce que vous y avez investi** (achat et améliorations). Une confirmation est demandée avant la vente. Vous perdez le revenu horaire qu'elle rapportait, et la commune redevient libre pour tous les joueurs. La vente est faite et vérifiée par le serveur.

## Commandes

- **Glisser** (clic gauche) : faire tourner la Terre
- **Pincer à deux doigts** sur le pavé tactile, comme sur un smartphone : zoomer vers l'endroit pincé
- **Molette** de souris : zoomer et dézoomer
- **Clic droit + glisser** : incliner la vue
- **Clic** sur une commune : ouvrir sa fiche

## Limites des communes

Le quadrillage doré montre les limites des communes, en blanc celles des départements, des régions et des pays. Il vient des tuiles gratuites OpenFreeMap (données OpenStreetMap), apparaît au fur et à mesure du zoom, et s'affiche par-dessus l'imagerie satellite (pas sur la Terre 3D de Google). Les points des communes apparaissent en même temps que les limites des villes.

Les arrondissements et quartiers (Paris, Lyon, Marseille, « Salpêtrière », « Maison Blanche »…) ne sont ni affichés ni achetables : en France, il n'y a qu'un lieu par commune.

Vos communes sont marquées d'un **point vert** visible à toutes les échelles, même depuis l'espace. Les communes des autres joueurs apparaissent **en rouge** quand on zoome au niveau d'une ville.

Pour régénérer la liste des communes : `python3 tools/build_communes.py cities500.txt data/communes.txt supabase/communes.csv` (fichier à télécharger sur https://download.geonames.org/export/dump/cities500.zip).

## Économie

- **Trésor de départ** : 0 ₵ (réglé dans `supabase/schema.sql`, fonction `handle_new_user`)
- **Prix d'une commune** : 1 000 ₵ + 0,50 ₵ par habitant (un village : environ 1 800 ₵, Versailles : 43 708 ₵, Lyon : 261 387 ₵, Paris : 1,07 million, Tokyo : 4,87 millions, Shanghai : 12,4 millions). Réglage en haut de `js/game.js`.
- **Revenu** : 15 % du prix par heure, donc une commune est rentabilisée en un peu moins de 7 heures

Avec un trésor de départ à 0 ₵, un nouveau joueur ne peut rien acheter. Pour tester, donnez-vous des crédits dans Supabase : **Table Editor > profiles**, modifiez la colonne `balance` de votre ligne.

## Activer la vraie Terre de Google Earth (bâtiments et relief en 3D)

Sans clé, le globe affiche des photos satellite Esri vues du dessus. Pour avoir les villes en 3D de Google, remplissez **une** des deux clés dans `js/config.js`.

**Option A, la plus simple : un jeton Cesium ion (gratuit)**
1. Créez un compte sur https://ion.cesium.com (offre Community gratuite).
2. Dans *Asset Depot*, ajoutez l'asset **Google Photorealistic 3D Tiles** à votre compte.
3. Dans *Access Tokens*, copiez votre jeton par défaut.
4. Collez-le dans `cesiumIonToken: "..."` dans `js/config.js`, puis rechargez la page.

**Option B : une clé Google Maps Platform**
1. Sur https://console.cloud.google.com, créez un projet et activez la facturation (Google offre un crédit mensuel gratuit).
2. Activez l'API **Map Tiles API**.
3. Créez une clé API (menu *Identifiants*) et limitez-la à votre site.
4. Collez-la dans `googleMapsApiKey: "..."` dans `js/config.js`.

## Ce qui reste à faire pour un vrai jeu en ligne

- **Clés Google** : si vous en ajoutez une, limitez-la à l'adresse du site.
- **Licences** : l'imagerie Esri est utilisable pour un prototype. Pour un jeu public ou payant, vérifiez les conditions d'Esri, de Google, de Nominatim et d'OpenFreeMap (affichage des crédits en bas à gauche).

## Fichiers

- `index.html` : la page du jeu
- `css/style.css` : l'apparence
- `js/game.js` : le globe, les règles du jeu, les comptes et le multijoueur
- `js/boundaries.js`, `js/mvt.js` : le calque des limites administratives
- `js/config.js` : vos clés (Supabase, Google, Cesium)
- `supabase/schema.sql`, puis `02_pack_bienvenue.sql`, `03_vente.sql`, `04_ameliorations.sql`, `05_defis.sql`, `06_defis_progressifs.sql`, `07_defi_5min.sql`, `08_coffres_evenements.sql` et `09_coffres_minute.sql` : la base de données à installer dans Supabase, dans cet ordre
- `supabase/communes.csv` : le catalogue des communes (prix et catégorie) à importer dans la table `communes`
- `data/communes.txt` : les communes (id GeoNames, nom, pays, latitude, longitude, population)
- `tools/build_communes.py` : le script qui fabrique `data/communes.txt`
