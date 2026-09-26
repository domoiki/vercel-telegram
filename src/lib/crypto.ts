import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const SALT = "tgai-gateway:v1";

let cachedKey: Buffer | null = null;

/**
 * Derives a 32-byte key from ENCRYPTION_KEY.
 * Accepts 64-char hex, base64, or an arbitrary passphrase (stretched with scrypt).
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Add it to your environment before storing credentials.",
    );
  }

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else if (/^[A-Za-z0-9+/]{43}=?$/.test(raw)) {
    key = Buffer.from(raw, "base64");
    if (key.length !== 32) key = stretch(raw);
  } else {
    key = stretch(raw);
  }

  if (key.length !== 32) key = stretch(raw);
  cachedKey = key;
  return key;
}

function stretch(passphrase: string): Buffer {
  return scryptSync(passphrase, SALT, 32);
}

/** `iv.tag.ciphertext`, all base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

/** Returns null when the payload is malformed, so one bad row can't crash a request. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Shows enough of a secret to recognise it, never enough to use it.
 * `sk-abc123…wxyz` style output is safe for the dashboard and for logs.
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "•".repeat(Math.max(trimmed.length, 4));
  const head = trimmed.slice(0, 4);
  const tail = trimmed.slice(-4);
  return `${head}${"•".repeat(6)}${tail}`;
}
