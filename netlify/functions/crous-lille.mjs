// =============================================================================
// Surveillance des logements CROUS à Lille — Netlify Scheduled Function
// -----------------------------------------------------------------------------
// Toutes les 5 minutes :
//   1. récupère les phases de recherche ouvertes sur trouverunlogement.lescrous.fr
//      (elles changent au fil de l'année, le script s'adapte tout seul) ;
//   2. interroge l'API de recherche pour la zone de Lille ;
//   3. compare avec les logements déjà vus (mémorisés dans Netlify Blobs) ;
//   4. vous prévient sur Telegram pour chaque nouveau logement.
//
// Variables d'environnement (à définir dans Netlify) :
//   TELEGRAM_BOT_TOKEN  (obligatoire) le token donné par @BotFather
//   TELEGRAM_CHAT_ID    (obligatoire) votre identifiant de discussion
//   CROUS_TOOL_IDS      (facultatif) ex. "48" ou "47,48" pour forcer les phases
// =============================================================================

import { getStore } from "@netlify/blobs";

export const config = { schedule: "*/5 * * * *" };

const BASE = "https://trouverunlogement.lescrous.fr";

// Zone surveillée : Lille + communes collées (Villeneuve-d'Ascq et ses campus,
// Lambersart, Loos, La Madeleine, Mons-en-Barœul…). Coin Nord-Ouest, coin Sud-Est.
const ZONE = [
  { lon: 2.95, lat: 50.70 },
  { lon: 3.2, lat: 50.57 },
];

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Origin: BASE,
  Referer: BASE + "/",
};

const DELAI_REQUETE_MS = 7000; // la fonction gratuite est coupée à ~10 s
const SEUIL_ALERTE_ERREURS = 6; // ~30 min d'échecs d'affilée avant de prévenir
const MAX_LOGEMENTS_PAR_MESSAGE = 8;
// Changer cette clé remet la surveillance à zéro (nouvelle confirmation envoyée).
const CLE_ETAT = "etat-v2";

// -----------------------------------------------------------------------------
// Réseau
// -----------------------------------------------------------------------------
async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DELAI_REQUETE_MS);
  try {
    const r = await fetch(url, { ...options, headers: HEADERS, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Notifications Telegram
// Un message = { titre, blocs: [ { lignes: [...], lien?, texteLien? } ], fin? }
// -----------------------------------------------------------------------------
const echapperHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function mettreEnForme(m) {
  const parts = [`<b>${echapperHtml(m.titre)}</b>`];
  for (const b of m.blocs || []) {
    parts.push("", ...b.lignes.map(echapperHtml));
    if (b.lien) parts.push(`👉 <a href="${b.lien}">${echapperHtml(b.texteLien || "Voir le logement")}</a>`);
  }
  if (m.fin) parts.push("", echapperHtml(m.fin));
  return parts.join("\n");
}

async function notifier(m) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant dans les variables Netlify.");
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: mettreEnForme(m),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      console.error("Erreur Telegram :", r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Erreur Telegram :", e.message);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Phases de recherche ("tools")
// -----------------------------------------------------------------------------
function premiereDate(obj, motCle) {
  for (const [cle, val] of Object.entries(obj)) {
    if (cle.toLowerCase().includes(motCle) && val && typeof val !== "object") {
      const d = new Date(val);
      if (!isNaN(d)) return d;
    }
  }
  return null;
}

export async function phasesOuvertes(maintenant = new Date()) {
  const forcees = (process.env.CROUS_TOOL_IDS || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  if (forcees.length) return forcees.map((id) => ({ id, nom: `phase ${id}`, mecanisme: null }));

  const data = await fetchJson(`${BASE}/api/fr/tools`);
  const liste = Array.isArray(data)
    ? data
    : data?.results?.items || data?.results || data?.items || data?.tools || [];
  if (!Array.isArray(liste) || !liste.length) {
    throw new Error("Liste des phases vide ou format inattendu");
  }

  console.log(
    `Phases publiées par le CROUS (${liste.length}) : ` +
      liste
        .map((t) => {
          const dates = Object.entries(t || {})
            .filter(([k, v]) => /start|begin|end|debut|fin|date/i.test(k) && v && typeof v !== "object")
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
          return `[${t?.id}] ${t?.label || t?.name || "?"} ${dates}`;
        })
        .join(" | "),
  );

  return liste
    .filter((t) => {
      if (!t || t.id == null) return false;
      const debut = premiereDate(t, "start") || premiereDate(t, "begin") || premiereDate(t, "debut");
      const fin = premiereDate(t, "end") || premiereDate(t, "fin");
      if (debut && debut > maintenant) return false;
      if (fin && fin < maintenant) return false;
      return true;
    })
    .map((t) => ({
      id: t.id,
      nom: t.label || t.name || t.title || `phase ${t.id}`,
      mecanisme: t.toolMechanism || t.mechanism || null,
    }));
}

// -----------------------------------------------------------------------------
// Recherche des logements d'une phase
// -----------------------------------------------------------------------------
async function logementsDeLaPhase(phase) {
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const corps = {
      idTool: phase.id,
      need_aggregation: false,
      page,
      pageSize: 100,
      sector: null,
      occupationModes: [],
      location: ZONE,
      residence: null,
      precision: 6,
      equipment: [],
      price: { min: 0, max: 10000000 },
    };
    if (phase.mecanisme) corps.toolMechanism = phase.mecanisme;

    const data = await fetchJson(`${BASE}/api/fr/search/${phase.id}`, {
      method: "POST",
      body: JSON.stringify(corps),
    });
    const res = data?.results;
    if (!res || !Array.isArray(res.items)) {
      throw new Error(`Réponse inattendue pour la phase ${phase.id}`);
    }
    items.push(...res.items);
    let total = res.total;
    if (total && typeof total === "object") total = total.value;
    if (!res.items.length || items.length >= Number(total || 0)) break;
  }
  return items;
}

const lienLogement = (phase, item) => `${BASE}/tools/${phase.id}/accommodations/${item.id}`;

export function decrire(item, phase) {
  const nom = item.label || "Logement";
  const residence = item.residence?.label || "";
  const adresse = item.residence?.address || "";
  let loyer = "?";
  try {
    const rent = item.occupationModes?.[0]?.rent;
    const e = (c) => (c / 100).toFixed(2).replace(/\.00$/, "").replace(".", ",");
    if (rent?.min != null) {
      loyer = rent.max != null && rent.max !== rent.min ? `${e(rent.min)} – ${e(rent.max)} €` : `${e(rent.min)} €`;
    } else if (Array.isArray(item.rentRange) && item.rentRange.length) {
      loyer = `${item.rentRange[0]} €`;
    }
  } catch {
    /* on garde "?" */
  }
  const surface = item.area?.min ? ` · ${item.area.min} m²` : "";
  const lignes = [`🏠 ${nom}`];
  if (residence) lignes.push(`📍 ${residence}${adresse ? " — " + adresse : ""}`);
  lignes.push(`💶 ${loyer}${surface}`);
  return { lignes, lien: lienLogement(phase, item), texteLien: "Réserver maintenant" };
}

// -----------------------------------------------------------------------------
// Point d'entrée
// -----------------------------------------------------------------------------
export default async () => {
  const store = getStore("crous-lille");
  const etat = (await store.get(CLE_ETAT, { type: "json" })) || {
    initialise: false,
    vus: [],
    erreurs: 0,
    alerteEnvoyee: false,
  };
  const vus = new Set(etat.vus);

  let phases;
  let resultats;
  try {
    phases = await phasesOuvertes();
    resultats = await Promise.all(
      phases.map(async (p) => ({ phase: p, items: await logementsDeLaPhase(p) })),
    );
  } catch (e) {
    console.error("Échec de la vérification :", e.message);
    etat.erreurs = (etat.erreurs || 0) + 1;
    if (etat.erreurs >= SEUIL_ALERTE_ERREURS && !etat.alerteEnvoyee) {
      await notifier({
        titre: "⚠️ Surveillance CROUS en panne",
        blocs: [
          {
            lignes: [
              `Le site du CROUS ne répond plus correctement depuis environ ${etat.erreurs * 5} minutes.`,
              `Erreur : ${e.message}`,
            ],
          },
        ],
        fin: "La surveillance continue d'essayer, vous serez prévenu quand elle repart.",
      });
      etat.alerteEnvoyee = true;
    }
    await store.setJSON(CLE_ETAT, etat);
    return new Response("erreur", { status: 500 });
  }

  console.log(
    `Phases surveillées : ${phases.map((p) => `[${p.id}] ${p.nom}`).join(", ") || "AUCUNE"} — ` +
      resultats.map(({ phase, items }) => `phase ${phase.id} : ${items.length} logement(s)`).join(", "),
  );

  if (etat.alerteEnvoyee) {
    await notifier({ titre: "✅ La surveillance CROUS fonctionne de nouveau." });
  }
  etat.erreurs = 0;
  etat.alerteEnvoyee = false;

  const nouveaux = [];
  let totalEnLigne = 0;
  for (const { phase, items } of resultats) {
    for (const item of items) {
      if (item?.id == null) continue;
      totalEnLigne++;
      const cle = `${phase.id}:${item.id}`;
      if (!vus.has(cle)) {
        nouveaux.push({ item, phase });
        vus.add(cle);
      }
    }
  }

  if (!etat.initialise) {
    // Premier passage : on mémorise l'existant et on envoie UNE confirmation.
    const envoye = await notifier({
      titre: "✅ Surveillance CROUS Lille activée",
      blocs: [
        {
          lignes: [
            `Phases surveillées : ${phases.map((p) => p.nom).join(", ") || "aucune ouverte pour l'instant"}`,
            `Logements actuellement en ligne : ${totalEnLigne}`,
          ],
        },
        ...nouveaux.slice(0, MAX_LOGEMENTS_PAR_MESSAGE).map(({ item, phase }) => decrire(item, phase)),
      ],
      fin: "Vous recevrez un message à chaque nouveau logement.",
    });
    // Si Telegram n'a pas pu être joint, on réessaiera au prochain passage.
    etat.initialise = envoye;
    if (!envoye) vus.clear();
  } else if (nouveaux.length) {
    // Les nouveaux logements sont regroupés (8 max par message) pour éviter
    // un message trop long ou une rafale de notifications.
    for (let i = 0; i < nouveaux.length; i += MAX_LOGEMENTS_PAR_MESSAGE) {
      const lot = nouveaux.slice(i, i + MAX_LOGEMENTS_PAR_MESSAGE);
      await notifier({
        titre: lot.length > 1 ? `🚨 ${lot.length} nouveaux logements CROUS à Lille` : "🚨 Nouveau logement CROUS à Lille",
        blocs: lot.map(({ item, phase }) => decrire(item, phase)),
        fin: "Vite, les places partent en quelques minutes !",
      });
    }
  }

  etat.vus = [...vus].slice(-5000);
  await store.setJSON(CLE_ETAT, etat);

  console.log(`OK — ${totalEnLigne} en ligne, ${nouveaux.length} nouveau(x).`);
  return new Response("ok");
};
