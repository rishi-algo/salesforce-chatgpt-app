import fetch from "node-fetch";
import crypto from "crypto";
import { saveConnection } from "./vault.js";

function authBase(env) {
  return env === "sandbox" ? "https://test.salesforce.com" : "https://login.salesforce.com";
}

function tokenUrl(env) {
  return `${authBase(env)}/services/oauth2/token`;
}

export function oauthStart(req, res) {
  const env = req.query.env === "sandbox" ? "sandbox" : "prod";
  const userKey = req.headers["x-user-key"] || "dev-user"; // replace with ChatGPT identity later

  const state = crypto.randomBytes(16).toString("hex");
  // store state temporarily (cookie for quick win)
  res.cookie("sf_oauth_state", JSON.stringify({ state, env, userKey }), { httpOnly: true, sameSite: "lax" });

  const redirectUri = `${process.env.BASE_URL}${process.env.SF_CALLBACK_PATH}`;
  const scope = encodeURIComponent("openid api refresh_token");
  const url =
    `${authBase(env)}/services/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(process.env.SF_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&state=${encodeURIComponent(state)}`;

  res.json({ auth_url: url });
}

export async function oauthCallback(req, res) {
  const code = req.query.code;
  const state = req.query.state;

  const cookie = req.cookies.sf_oauth_state ? JSON.parse(req.cookies.sf_oauth_state) : null;
  if (!cookie || cookie.state !== state) return res.status(400).send("Invalid state");

  const { env, userKey } = cookie;
  const redirectUri = `${process.env.BASE_URL}${process.env.SF_CALLBACK_PATH}`;

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("client_id", process.env.SF_CLIENT_ID);
  form.set("client_secret", process.env.SF_CLIENT_SECRET);
  form.set("redirect_uri", redirectUri);

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

  // For quick win: show success page
  res.send("Salesforce connected. You can go back to ChatGPT.");
}
