/**
 * Authenticated encryption for secrets at rest (AES-256-GCM).
 *
 * Envelope format: "v{keyVersion}.{iv b64url}.{tag b64url}.{ciphertext b64url}"
 * Keys: HOSTPOG_MASTER_KEY (current, base64 32 bytes) with HOSTPOG_MASTER_KEY_VERSION,
 * plus optional HOSTPOG_MASTER_KEY_PREVIOUS / _PREVIOUS_VERSION for rotation.
 * Associated data binds a ciphertext to its owning workspace + purpose so a row
 * copied to another tenant cannot be decrypted there.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface Key {
  version: number;
  key: Buffer;
}

function parseKey(b64: string | undefined, version: string | undefined): Key | null {
  if (!b64) return null;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("HostPog master key must be 32 bytes, base64 encoded");
  return { version: Number(version ?? "1"), key };
}

function keys(): { current: Key; all: Map<number, Buffer> } {
  const current = parseKey(process.env.HOSTPOG_MASTER_KEY, process.env.HOSTPOG_MASTER_KEY_VERSION);
  if (!current) throw new Error("HOSTPOG_MASTER_KEY is not set (generate one with: openssl rand -base64 32)");
  const prev = parseKey(process.env.HOSTPOG_MASTER_KEY_PREVIOUS, process.env.HOSTPOG_MASTER_KEY_PREVIOUS_VERSION);
  const all = new Map<number, Buffer>([[current.version, current.key]]);
  if (prev) all.set(prev.version, prev.key);
  return { current, all };
}

export function encryptSecret(plaintext: string, aad: string): { ciphertext: string; keyVersion: number } {
  const { current } = keys();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", current.key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return {
    ciphertext: `v${current.version}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`,
    keyVersion: current.version,
  };
}

export function decryptSecret(envelope: string, aad: string): string {
  const m = /^v(\d+)\.([\w-]+)\.([\w-]+)\.([\w-]*)$/.exec(envelope);
  if (!m) throw new Error("malformed secret envelope");
  const key = keys().all.get(Number(m[1]));
  if (!key) throw new Error(`no master key available for version ${m[1]}`);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(m[2]!, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(m[3]!, "base64url"));
  return Buffer.concat([d.update(Buffer.from(m[4]!, "base64url")), d.final()]).toString("utf8");
}

/** Non-secret display hint: keeps a short prefix and the last 3 chars. */
export function secretHint(secret: string): string {
  const prefix = secret.match(/^[a-z]{2,4}_/i)?.[0] ?? "";
  return `${prefix}…${secret.slice(-3)}`;
}

export function credentialAad(workspaceId: string, kind: string): string {
  return `hostpog:credential:${workspaceId}:${kind}`;
}
