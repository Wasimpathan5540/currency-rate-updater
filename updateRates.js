// updateRates.js - tries several free APIs and writes the first valid rates result
const admin = require("firebase-admin");
const axios = require("axios");

const SA_JSON = process.env.FIREBASE_SA_KEY;
const DB_URL = process.env.DB_URL || "https://currencyconverter-48640-default-rtdb.firebaseio.com";

if (!SA_JSON) {
  console.error("Missing FIREBASE_SA_KEY environment variable.");
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
  // Some APIs use 'rates' nested under another key
  for (const k of Object.keys(apiData)) {
    if (apiData[k] && typeof apiData[k] === "object" && apiData[k].rates && typeof apiData[k].rates === "object") {
      return apiData[k].rates;
    }
  }
  // Some APIs (like open.er-api.com) return `rates` under top-level as well but with different shape - already covered.
  return null;
}

async function main() {
  const apis = [
    { name: "exchangerate.host", url: "https://api.exchangerate.host/latest?base=USD" },
    { name: "open.er-api.com",  url: "https://open.er-api.com/v6/latest/USD" }, // alternative
    { name: "frankfurter",      url: "https://api.frankfurter.app/latest?from=USD" } // different shape: rates is present
  ];

  for (const api of apis) {
    console.log("Trying API:", api.name, api.url);
    const result = await tryFetch(api.url, { timeout: 15000 });
    if (!result.ok) {
      console.warn("Fetch failed:", result.url, result.error);
      await admin.database().ref("exchangeRatesDiagnostics").push({
        time: Date.now(),
        api: api.name,
        url: result.url,
        fetchError: result.error
      });
      continue;
    }

    // Log preview (trim to safe size)
    let preview;
    try {
      preview = JSON.stringify(result.data);
      if (preview.length > 4000) preview = preview.slice(0, 4000) + "...(truncated)";
    } catch (e) {
      preview = String(result.data);
    }
    console.log("API response preview for", api.name, ":", preview);

    // try extract rates
    let rates = extractRates(result.data);

    // frankfurter returns rates under `rates` but base is `base` or `from`. Normalize:
    if (!rates && result.data && result.data.rates && typeof result.data.rates === "object") {
      rates = result.data.rates;
    }

    if (!rates || Object.keys(rates).length === 0) {
      console.warn("No usable 'rates' in response from", api.name);
      // save diagnostic
      await admin.database().ref("exchangeRatesDiagnostics").push({
        time: Date.now(),
        api: api.name,
        url: api.url,
        apiPreview: result.data,
        note: "No rates object found"
      });
      continue; // try next API
    }

    // success: determine base
    const base = result.data.base || result.data.base_code || result.data.baseCurrency || result.data.query?.base || "USD";
    const timestamp = Math.floor(Date.now() / 1000);

    const payload = {
      base: base || "USD",
      timestamp,
      rates
    };

    console.log("Writing payload to DB. base:", payload.base, "ratesCount:", Object.keys(rates).length);
    await admin.database().ref("exchangeRates").set(payload);
    console.log("Rates updated at:", new Date(timestamp * 1000).toISOString(), "from", api.name);
    return process.exit(0);
  }

  // If we reach here, none of the APIs returned usable rates
  console.error("All APIs failed to provide rates. See diagnostics in 'exchangeRatesDiagnostics'.");
  process.exit(1);
}

main();
