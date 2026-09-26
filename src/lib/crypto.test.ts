import { beforeAll, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, maskSecret } from "./crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

describe("encryptSecret", () => {
  it("round-trips a secret", () => {
    const secret = "123456:AAF-fake_bot_token_value";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("never stores the plaintext in the payload", () => {
    const payload = encryptSecret("super-secret-value");
    expect(payload).not.toContain("super-secret-value");
    expect(payload.split(".")).toHaveLength(3);
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per call means identical secrets are not visibly identical.
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
});

describe("decryptSecret", () => {
  it("returns null for missing input", () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });

  it("returns null for a malformed payload instead of throwing", () => {
    expect(decryptSecret("not-base64")).toBeNull();
    expect(decryptSecret("a.b")).toBeNull();
    expect(decryptSecret("a.b.c.d")).toBeNull();
  });

  it("returns null when the ciphertext has been tampered with", () => {
    const payload = encryptSecret("original");
    const parts = payload.split(".");
    const data = Buffer.from(parts[2] as string, "base64");
    data[0] = (data[0] as number) ^ 0xff;
    parts[2] = data.toString("base64");
    expect(decryptSecret(parts.join("."))).toBeNull();
  });
});

describe("maskSecret", () => {
  it("keeps a short recognisable head and tail", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a••••••mnop");
  });

  it("fully masks a short value", () => {
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret("")).toBeNull();
    expect(maskSecret(null)).toBeNull();
  });

  it("never reveals the middle of a secret", () => {
    const secret = "123456:AAF-verylongsecrethere";
    const masked = maskSecret(secret);
    expect(masked).not.toBe(secret);
    expect(masked).toHaveLength(14);
  });
});
