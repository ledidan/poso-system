const TOKEN_URL = "https://oauth2.googleapis.com/token";
const encode = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
export const createGoogleTokenProvider = ({ email, privateKey, scope, fetcher = fetch, now = Date.now }) => {
  let cached;
  let key;
  return async () => {
    if (cached?.expiresAt > now() + 60_000) return cached.token;
    if (!key) {
      const pem = privateKey.replace(/\\n/g, "\n").replace(/-----[^-]+-----|\s/g, "");
      key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    }
    const issuedAt = Math.floor(now() / 1000);
    const unsigned = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encode(JSON.stringify({ iss: email, scope, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600 }))}`;
    const bytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
    const signature = btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const response = await fetcher(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Service credential exchange failed (${response.status}).`);
    const value = await response.json();
    if (typeof value.access_token !== "string" || !Number.isFinite(Number(value.expires_in))) throw new Error("Invalid service credential response.");
    cached = { token: value.access_token, expiresAt: now() + Number(value.expires_in) * 1000 };
    return cached.token;
  };
};
