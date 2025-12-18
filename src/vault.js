import crypto from "crypto";

const mem = new Map(); // replace with DB later

function keyFromSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest(); // 32 bytes
}

export function saveConnection({ userKey, env, instanceUrl, accessToken, refreshToken, identityUrl, orgId }) {
  const secret = process.env.VAULT_SECRET;
  if (!secret) throw new Error("VAULT_SECRET missing");

  const k = keyFromSecret(secret);
  const iv = crypto.randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify({ accessToken, refreshToken }), "utf8");

  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  mem.set(`${userKey}:${env}`, {
    userKey,
    env,
    instanceUrl,
    identityUrl,
    orgId,
    blob: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    updatedAt: Date.now()
  });
}

export function getConnection({ userKey, env }) {
  const row = mem.get(`${userKey}:${env}`);
  if (!row) return null;

  const secret = process.env.VAULT_SECRET;
  const k = keyFromSecret(secret);

  const iv = Buffer.from(row.iv, "base64");
  const tag = Buffer.from(row.tag, "base64");
  const enc = Buffer.from(row.blob, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  const tokens = JSON.parse(dec.toString("utf8"));

  return { ...row, ...tokens };
}

export function revokeConnection({ userKey, env }) {
  mem.delete(`${userKey}:${env}`);
}
