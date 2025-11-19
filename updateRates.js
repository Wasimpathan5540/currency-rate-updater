// updateRates.js
const admin = require("firebase-admin");
const axios = require("axios");

const SA_JSON = process.env.FIREBASE_SA_KEY; // stored in GitHub Secrets
const DB_URL = process.env.DB_URL || "https://<your-project-id>.firebaseio.com"; // REPLACE <your-project-id>

if (!SA_JSON) {
  console.error("Missing FIREBASE_SA_KEY environment variable.");
  process.exit(1);
}

try {
  var serviceAccount = JSON.parse(SA_JSON);
} catch (err) {
  console.error("Failed to parse FIREBASE_SA_KEY JSON:", err.message || err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DB_URL
});

async function fetchRates() {
  // exchangerate.host is free and doesn't require an API key
  const res = await axios.get("https://api.exchangerate.host/latest?base=USD");
  return res.data;
}

async function main() {
  try {
    const data = await fetchRates();
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      base: data.base || "USD",
      timestamp,
      rates: data.rates || {}
    };

    await admin.database().ref("exchangeRates").set(payload);
    console.log("Rates updated at:", new Date(timestamp * 1000).toISOString());
    process.exit(0);
  } catch (err) {
    console.error("Update failed:", err.message || err);
    process.exit(1);
  }
}

main();
