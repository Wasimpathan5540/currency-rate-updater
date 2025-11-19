// updateRates.js (verbose + safe)
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

function extractRates(apiData) {
  if (!apiData) return null;
  if (apiData.rates && typeof apiData.rates === "object") return apiData.rates;
  if (apiData.data && apiData.data.rates && typeof apiData.data.rates === "object") return apiData.data.rates;
  for (const k of Object.keys(apiData)) {
    if (apiData[k] && apiData[k].rates && typeof apiData[k].rates === "object") return apiData[k].rates;
  }
  return null;
}

async function fetchRates() {
  const url = "https://api.exchangerate.host/latest?base=USD";
  console.log("Fetching rates from:", url);
  const res = await axios.get(url, { timeout: 15000 });
  console.log("HTTP status:", res.status);
  const preview = JSON.stringify(res.data).slice(0, 4000);
  console.log("API response preview:", preview);
  return res.data;
}

async function main() {
  try {
    const data = await fetchRates();
    const rates = extractRates(data);

    if (!rates || Object.keys(rates).length === 0) {
      console.error("No 'rates' object found in API response. Aborting DB write.");
      // write diagnostics so you can inspect in Firebase console
      await admin.database().ref("exchangeRatesDiagnostics").push({
        time: Date.now(),
        note: "No rates in API response",
        apiPreview: data
      });
      process.exit(1);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      base: data.base || (data.data && data.data.base) || "USD",
      timestamp,
      rates
    };

    console.log("Writing payload: base =", payload.base, "ratesCount =", Object.keys(rates).length);
    await admin.database().ref("exchangeRates").set(payload);
    console.log("Rates updated at:", new Date(timestamp * 1000).toISOString());
    process.exit(0);

  } catch (err) {
    console.error("Update failed:", err && err.message ? err.message : err);
    try {
      await admin.database().ref("exchangeRatesDiagnostics").push({
        time: Date.now(),
        error: (err && err.message) ? err.message : String(err)
      });
    } catch (dbErr) {
      console.error("Also failed to write diagnostics:", dbErr);
    }
    process.exit(1);
  }
}

main();
