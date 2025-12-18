import fetch from "node-fetch";
import { getConnection, saveConnection } from "./vault.js";

const API_VER = "v59.0";

function authBase(env) {
  return env === "sandbox" ? "https://test.salesforce.com" : "https://login.salesforce.com";
}

async function refreshAccessToken(env, refreshToken) {
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  form.set("client_id", process.env.SF_CLIENT_ID);
  form.set("client_secret", process.env.SF_CLIENT_SECRET);

  const r = await fetch(`${authBase(env)}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function sfRequest({ userKey, env, method, path, body }) {
  const conn = getConnection({ userKey, env });
  if (!conn) return { ok: false, status: 401, json: { error: { code: "NOT_CONNECTED", message: "Connect Salesforce first." } } };

  async function doCall(accessToken) {
    const url = `${conn.instanceUrl}/services/data/${API_VER}${path}`;
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  }

  // first attempt
  let resp = await doCall(conn.accessToken);

  // refresh on invalid session
  if (!resp.ok && (resp.status === 401 || (Array.isArray(resp.json) && resp.json[0]?.errorCode === "INVALID_SESSION_ID"))) {
    const newAccess = await refreshAccessToken(env, conn.refreshToken);
    // save updated access token
    saveConnection({
      userKey,
      env,
      instanceUrl: conn.instanceUrl,
      accessToken: newAccess,
      refreshToken: conn.refreshToken,
      identityUrl: conn.identityUrl,
      orgId: conn.orgId
    });
    resp = await doCall(newAccess);
  }

  return resp;
}
