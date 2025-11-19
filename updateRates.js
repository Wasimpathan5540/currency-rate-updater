// updateRates.js - ROOT VERSION
const admin = require("firebase-admin");
const axios = require("axios");

// Support multiple env names
const SA_JSON = process.env.FIREBASE_SA_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.SA_JSON;
const DB_URL = process.env.FIREBASE_DB_URL || process.env.DB_URL;

if (!SA_JSON) {
  console.error("Missing FIREBASE_SA_KEY environment variable.");
  process.exit(1);
}
if (!DB_URL) {
  console.error("Missing FIREBASE_DB_URL environment variable.");
  process.exit(1);
}

let serviceAccount;
try { serviceAccount = JSON.parse(SA_JSON); }
catch (err) {
  console.error("Failed to parse FIREBASE_SA_KEY:", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DB_URL
});

const db = admin.database();

async function tryFetch(url) {
  try {
    const res = await axios.get(url, { timeout: 15000 });
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function extractRates(data) {
  if (data.rates) return data.rates;
  if (data.data?.rates) return data.data.rates;
  for (const k of Object.keys(data)) {
    if (data[k]?.rates) return data[k].rates;
  }
  return null;
}

function normalizeRates(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (!isNaN(n)) out[k] = n;
  }
  return out;
}

async function main() {
  const apis = [
    { name: "exchangerate.host", url: "https://api.exchangerate.host/latest?base=USD" },
    { name: "open.er-api.com", url: "https://open.er-api.com/v6/latest/USD" },
    { name: "frankfurter", url: "https://api.frankfurter.app/latest?from=USD" }
  ];

  for (const api of apis) {
    console.log("Trying:", api.name);

    const result = await tryFetch(api.url);
    if (!result.ok) {
      console.warn("Fetch failed:", result.error);
      continue;
    }

    const raw = extractRates(result.data);
    if (!raw) {
      console.warn("No usable rates from:", api.name);
      continue;
    }

    const rates = normalizeRates(raw);

    const base = result.data.base || "USD";

 
const updates = {};
updates["/exchangeRates/rates"] = rates;
updates["/exchangeRates_meta"] = { base, lastUpdated: admin.database.ServerValue.TIMESTAMP, provider: api.name };
await db.ref().update(updates);

    console.log("Updated successfully:", Object.keys(rates).length, "rates");
    return process.exit(0);
  }

  console.error("All APIs failed.");
  process.exit(1);
}

main();
