# Surveillance des logements CROUS à Lille

Ce projet vérifie **toutes les 5 minutes, 24h/24**, les logements CROUS disponibles à Lille (et communes collées : Villeneuve-d'Ascq, Lambersart, Loos, La Madeleine…) sur trouverunlogement.lescrous.fr.

Dès qu'un nouveau logement apparaît, vous recevez un **message Telegram** avec le nom, la résidence, le loyer et le lien pour réserver. Tout tourne gratuitement sur Netlify, votre ordinateur peut rester éteint.

Comptez environ **20 minutes** pour l'installation, en 4 étapes.

---

## Étape 1 — Créer votre bot Telegram

1. **Installez Telegram** sur votre téléphone et créez un compte.
2. **Créez votre bot** : dans Telegram, cherchez **@BotFather** (avec le badge bleu de vérification) et envoyez-lui `/newbot`.
   - Donnez-lui un nom, par exemple `Alerte CROUS Lille`.
   - Donnez-lui un identifiant qui finit par `bot`, par exemple `alerte_crous_lille_bot`.
   - BotFather vous répond avec un **token**, une ligne qui ressemble à `123456789:AAH...`. Gardez-le de côté et ne le partagez avec personne.
3. **Écrivez à votre bot** : cliquez sur le lien de votre bot donné par BotFather, appuyez sur **Démarrer**, puis envoyez-lui un message, par exemple « salut ».
4. **Récupérez votre identifiant de discussion** : dans un navigateur, ouvrez cette adresse en remplaçant `VOTRE_TOKEN` par votre token :
   `https://api.telegram.org/botVOTRE_TOKEN/getUpdates`
   Cherchez `"chat":{"id":` suivi d'un nombre, par exemple `"chat":{"id":987654321`. Notez ce nombre.
   Si la page n'affiche que `"result":[]`, renvoyez un message à votre bot et rechargez la page.
5. Dans Telegram, ouvrez la discussion avec votre bot et vérifiez que **les notifications sont activées avec le son**.

---

## Étape 2 — Mettre le code sur GitHub

1. Créez un compte gratuit sur **github.com** si vous n'en avez pas.
2. En haut à droite : **+** → **New repository**.
   - Nom : `crous-lille`
   - Visibilité : **Private** (c'est possible ici, pas besoin de public)
   - Cliquez sur **Create repository**.
3. Sur la page du dépôt vide, cliquez sur le lien **uploading an existing file**.
4. Décompressez `crous-lille.zip` sur votre ordinateur, ouvrez le dossier `crous-lille`, sélectionnez **tout son contenu** (le dossier `netlify`, le dossier `public`, `netlify.toml`, `package.json`, `README.md`, `.gitignore`) et glissez-le dans la page GitHub.
   - Vérifiez que le fichier `netlify/functions/crous-lille.mjs` apparaît bien avec son dossier.
   - Si `.gitignore` n'apparaît pas (fichier caché), ce n'est pas grave.
5. Cliquez sur **Commit changes**.

---

## Étape 3 — Mettre en ligne sur Netlify

1. Allez sur **netlify.com** → **Sign up** → choisissez **Sign up with GitHub**.
2. **Add new project** (ou *Add new site*) → **Import an existing project** → **GitHub**.
3. Autorisez Netlify à accéder à votre dépôt `crous-lille` et sélectionnez-le.
4. Ne touchez à aucun réglage, cliquez sur **Deploy**.
5. Une fois déployé, allez dans **Project configuration** (ou *Site configuration*) → **Environment variables** → **Add a variable** et créez :

   | Nom | Valeur |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | le token de BotFather (étape 1.2) |
   | `TELEGRAM_CHAT_ID` | le nombre trouvé à l'étape 1.4 |

6. Allez dans **Deploys** → **Trigger deploy** → **Deploy project** (ou *Deploy site*), pour que les variables soient prises en compte.

---

## Étape 4 — Tester

1. Dans Netlify, allez dans **Logs** → **Functions** → `crous-lille`.
2. Cliquez sur **Run now** (ou attendez 5 minutes).
3. Vous devez recevoir sur Telegram : **« ✅ Surveillance CROUS Lille activée »**, avec le nombre de logements actuellement en ligne.

C'est tout. Ensuite, vous ne recevez un message **que lorsqu'un nouveau logement apparaît**.

---

## Conseils pour réserver plus vite

- Restez **connecté** à votre compte MesServices / trouverunlogement sur votre téléphone : quand le message arrive, un clic sur le lien et vous êtes sur la page de réservation.
- Ayez votre **Dossier Social Étudiant** et vos moyens de paiement prêts.
- Les logements partent souvent en quelques minutes : réagissez tout de suite.

---

## En cas de problème

**Je n'ai reçu aucun message après « Run now »**
Ouvrez les logs de la fonction dans Netlify :
- `TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant` → les variables d'environnement sont mal nommées ou vous n'avez pas redéployé (étape 3.6).
- `Erreur Telegram : 401` → le token est incorrect.
- `Erreur Telegram : 400 … chat not found` → l'identifiant de discussion est incorrect, ou vous n'avez pas appuyé sur **Démarrer** dans la discussion avec votre bot.
- `HTTP 403` ou `HTTP 429` sur lescrous.fr → le site du CROUS bloque les serveurs de Netlify. Dans ce cas, revenez vers moi : on basculera sur une autre solution (GitHub Actions ou Oracle Cloud).

**J'ai reçu « ⚠️ Surveillance CROUS en panne »**
Le site du CROUS ne répond plus depuis 30 minutes (souvent une maintenance). La surveillance continue d'essayer seule et vous envoie « ✅ fonctionne de nouveau » quand ça repart.

**« Phases surveillées : aucune ouverte »**
Le CROUS organise la recherche en « phases » (rentrée, phase complémentaire, fil de l'eau…). Le script les détecte automatiquement. Si aucune n'est trouvée alors que le site affiche des logements :
1. Ouvrez trouverunlogement.lescrous.fr, faites une recherche sur Lille et regardez l'adresse de la page : `.../tools/48/search...`, le nombre (ici 48) est l'identifiant de la phase.
2. Dans Netlify, ajoutez la variable `CROUS_TOOL_IDS` avec ce nombre, puis redéployez.

**Crédits Netlify**
L'offre gratuite donne 300 crédits par mois ; ce script en consomme une petite partie. Vous pouvez suivre la consommation dans **Usage** sur Netlify. Si les crédits venaient à manquer, le service se met en pause jusqu'au mois suivant, sans aucun frais.

**Arrêter la surveillance** (quand vous avez trouvé votre logement 🎉)
Netlify → **Project configuration** → **General** → **Delete project**.
