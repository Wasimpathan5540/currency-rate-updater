// scripts/updateRates.js
const admin = require("firebase-admin");
const axios = require("axios");

const SA_JSON = process.env.FIREBASE_SA_KEY;
const DB_URL = process.env.FIREBASE_DB_URL; // recommended env name

if (!SA_JSON) {
  console.error("Missing FIREBASE_SA_KEY environment variable.");
  process.exit(1);
}
if (!DB_URL) {
  console.error("Missing FIREBASE_DB_URL environment variable.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(SA_JSON);
} catch (err) {
  console.error("Failed to parse FIREBASE_SA_KEY JSON:", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DB_URL
});

const db = admin.database();

async function tryFetch(url, options = {}) {
  try {
    const res = await axios.get(url, options);
    return { ok: true, status: res.status, data: res.data, url };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e), url };
  }
}

function extractRates(apiData) {
  if (!apiData) return null;
  if (apiData.rates && typeof apiData.rates === "object") return apiData.rates;
  if (apiData.data && apiData.data.rates && typeof apiData.data.rates === "object") return apiData.data.rates;
  for (const k of Object.keys(apiData)) {
    if (apiData[k] && typeof apiData[k] === "object" && apiData[k].rates && typeof apiData[k].rates === "object") {
      return apiData[k].rates;
    }
  }
  return null;
}

function normalizeRates(rawRates) {
  const out = {};
  for (const [k, v] of Object.entries(rawRates)) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isNaN(n)) out[k] = n;
  }
  return out;
}

async function writeDiagnostics(obj) {
  try {
    const trimmed = Object.assign({}, obj);
    if (trimmed.apiPreview) {
      let p = trimmed.apiPreview;
      try { p = JSON.stringify(p); } catch(e) { p = String(p); }
      if (p.length > 2000) p = p.slice(0, 2000) + "...(truncated)";
      trimmed.apiPreview = p;
    }
    trimmed.time = Date.now();
    await db.ref("exchangeRatesDiagnostics").push(trimmed);
  } catch (e) {
    console.error("Failed writing diagnostic:", e);
  }
}

async function main() {
  const apis = [
    { name: "exchangerate.host", url: "https://api.exchangerate.host/latest?base=USD" },
    { name: "open.er-api.com",  url: "https://open.er-api.com/v6/latest/USD" },
    { name: "frankfurter",      url: "https://api.frankfurter.app/latest?from=USD" }
  ];

  for (const api of apis) {
    console.log("Trying API:", api.name, api.url);
    const result = await tryFetch(api.url, { timeout: 15000 });
    if (!result.ok) {
      console.warn("Fetch failed:", result.url, result.error);
      await writeDiagnostics({ api: api.name, url: result.url, fetchError: result.error });
      continue;
    }

    let preview;
    try {
      preview = JSON.stringify(result.data);
      if (preview.length > 2000) preview = preview.slice(0, 2000) + "...(truncated)";
    } catch (e) {
      preview = String(result.data);
    }
    console.log("API preview:", preview);

    let rawRates = extractRates(result.data);
    if (!rawRates && result.data && result.data.rates) rawRates = result.data.rates;
    if (!rawRates || Object.keys(rawRates).length === 0) {
      console.warn("No usable 'rates' in response from", api.name);
      await writeDiagnostics({ api: api.name, url: api.url, apiPreview: result.data, note: "No rates object found" });
      continue;
    }

    const rates = normalizeRates(rawRates);
    if (Object.keys(rates).length === 0) {
      await writeDiagnostics({ api: api.name, url: api.url, note: "Rates present but non-numeric after parsing", apiPreview: result.data });
      continue;
    }

    const base = result.data.base || result.data.base_code || result.data.baseCurrency || result.data.query?.base || "USD";
    const lastUpdated = Date.now();

    // Write atomically: rates under /exchangeRates/rates and a flat copy for older clients
    const updates = {};
    updates["/exchangeRates/rates"] = rates;
    updates["/exchangeRates_flat"] = rates; // optional: backward compatibility
    updates["/exchangeRates_meta"] = { base, lastUpdated, provider: api.name };

    await db.ref().update(updates);
    console.log("Successfully updated rates from", api.name, "count:", Object.keys(rates).length);
    return process.exit(0);
  }

  console.error("All APIs failed to provide rates. See exchangeRatesDiagnostics.");
  process.exit(1);
}

main();
