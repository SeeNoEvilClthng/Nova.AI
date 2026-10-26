// AES-256-GCM encryption for credentials stored in the database. Uses
// NOVA_ENCRYPTION_KEY, or the existing SOCIAL_TOKEN_ENCRYPTION_KEY so current
// deployments need no new variable. Either must be 64 hexadecimal characters.
const crypto = require("node:crypto");

function encryptionKey() {
  const raw = String(process.env.NOVA_ENCRYPTION_KEY || process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw Object.assign(new Error("Credential encryption is not configured. Add NOVA_ENCRYPTION_KEY (64 hex characters) in Vercel."), { status: 503 });
  return Buffer.from(raw, "hex");
}

const ready = () => { try { encryptionKey(); return true; } catch { return false; } };

function seal(plaintext) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return { ciphertext: encrypted.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

function open({ ciphertext, iv, tag }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

module.exports = { seal, open, ready };
