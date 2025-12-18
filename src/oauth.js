import fetch from "node-fetch";
import crypto from "crypto";
import { saveConnection } from "./vault.js";

// In-memory state store (quick win). Replace with Redis/DB later.
const stateStore = new Map();

function authBase(env) {
  return env === "sandbox" ? "https://test.salesforce.com" : "https://login.salesforce.com";
}

function tokenUrl(env) {
  return `${authBase(env)}/services/oauth2/token`;
}

// PKCE helpers
function base64url(input) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

export function oauthStart(req, res) {
  const env = req.query.env === "sandbox" ? "sandbox" : "prod";

  // For now you used x-user-key. Keep it.
  const userKey = req.headers["x-user-key"] || "dev-user";

  const state = crypto.randomBytes(16).toString("hex");

  // PKCE: verifier + challenge
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(sha256(Buffer.from(codeVerifier)));

  // Store state -> info on server (no cookies)
  stateStore.set(state, { env, userKey, codeVerifier, createdAt: Date.now() });

  const redirectUri = `${process.env.BASE_URL}${process.env.SF_CALLBACK_PATH}`;
  const scope = "openid api refresh_token";

  const url =
    `${authBase(env)}/services/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(process.env.SF_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256`;

  // Better UX: redirect directly
  res.redirect(url);
}

export async function oauthCallback(req, res) {
  // If Salesforce sends error in callback
  if (req.query.error) {
    return res
      .status(400)
      .send(`Salesforce OAuth error: ${req.query.error} - ${req.query.error_description || ""}`);
  }

  const code = req.query.code;
  const state = req.query.state;

  const st = stateStore.get(state);
  if (!st) return res.status(400).send("Invalid state");

  // one-time use
  stateStore.delete(state);

  const { env, userKey, codeVerifier } = st;
  const redirectUri = `${process.env.BASE_URL}${process.env.SF_CALLBACK_PATH}`;

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("client_id", process.env.SF_CLIENT_ID);
  form.set("client_secret", process.env.SF_CLIENT_SECRET); // keep if your connected app uses secret
  form.set("redirect_uri", redirectUri);
  form.set("code_verifier", codeVerifier);

  const r = await fetch(tokenUrl(env), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  const data = await r.json();
  if (!r.ok) return res.status(400).json({ error: data });

  const { access_token, refresh_token, instance_url, id: identity_url } = data;

  // Identity call
  const idr = await fetch(identity_url, { headers: { Authorization: `Bearer ${access_token}` } });
  const identity = await idr.json();
  const orgId = identity.organization_id;

  saveConnection({
    userKey,
    env,
    instanceUrl: instance_url,
    accessToken: access_token,
    refreshToken: refresh_token,
    identityUrl: identity_url,
    orgId
  });

  res.send("Salesforce connected ✅ You can go back to ChatGPT.");
}
