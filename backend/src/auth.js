// auth.js — SAP AI Core OAuth token manager
// Reads credentials from .env, fetches bearer tokens, auto-refreshes before expiry

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getToken() {
  const now = Date.now();

  // Return cached token if still valid (60s safety margin)
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const { SAP_AUTH_URL, SAP_CLIENT_ID, SAP_CLIENT_SECRET } = process.env;

  if (!SAP_AUTH_URL || !SAP_CLIENT_ID || !SAP_CLIENT_SECRET) {
    throw new Error(
      "Missing SAP credentials. Set SAP_AUTH_URL, SAP_CLIENT_ID, SAP_CLIENT_SECRET in .env"
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SAP_CLIENT_ID,
    client_secret: SAP_CLIENT_SECRET,
  });

  const res = await fetch(SAP_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SAP auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // expires_in is in seconds
  tokenExpiresAt = now + data.expires_in * 1000;

  console.log(`[auth] Token refreshed, expires in ${data.expires_in}s`);
  return cachedToken;
}