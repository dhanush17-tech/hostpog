import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { credentialAad, decryptSecret, encryptSecret, secretHint } from "../src/crypto";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function setKey(version = "1") {
  process.env.HOSTPOG_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.HOSTPOG_MASTER_KEY_VERSION = version;
}

describe("secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    setKey();
    const aad = credentialAad("ws-1", "posthog_api_key");
    const { ciphertext } = encryptSecret("phx_supersecret", aad);
    expect(ciphertext).not.toContain("supersecret");
    expect(decryptSecret(ciphertext, aad)).toBe("phx_supersecret");
  });

  it("binds ciphertext to its workspace (AAD)", () => {
    setKey();
    const { ciphertext } = encryptSecret("phx_x", credentialAad("ws-1", "posthog_api_key"));
    expect(() => decryptSecret(ciphertext, credentialAad("ws-2", "posthog_api_key"))).toThrow();
  });

  it("detects tampering", () => {
    setKey();
    const aad = "a";
    const { ciphertext } = encryptSecret("value", aad);
    const parts = ciphertext.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decryptSecret(parts.join("."), aad)).toThrow();
  });

  it("supports master-key rotation via the previous key", () => {
    setKey("1");
    const old = encryptSecret("rotate-me", "a");
    process.env.HOSTPOG_MASTER_KEY_PREVIOUS = process.env.HOSTPOG_MASTER_KEY;
    process.env.HOSTPOG_MASTER_KEY_PREVIOUS_VERSION = "1";
    setKey("2");
    expect(decryptSecret(old.ciphertext, "a")).toBe("rotate-me");
    expect(encryptSecret("new", "a").keyVersion).toBe(2);
  });

  it("refuses to run without a valid key", () => {
    delete process.env.HOSTPOG_MASTER_KEY;
    expect(() => encryptSecret("x", "a")).toThrow(/HOSTPOG_MASTER_KEY/);
    process.env.HOSTPOG_MASTER_KEY = "too-short";
    expect(() => encryptSecret("x", "a")).toThrow(/32 bytes/);
  });

  it("produces non-secret hints", () => {
    expect(secretHint("phx_abcdefghijklmnop")).toBe("phx_…nop");
  });
});
