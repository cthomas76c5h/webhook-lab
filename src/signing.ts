// Signatures in the Standard Webhooks format (standardwebhooks.com):
//   webhook-id:        evt_… (same on every retry, so receivers can dedupe)
//   webhook-timestamp: unix seconds of this attempt
//   webhook-signature: v1,<base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`>
// Several space-separated signatures are allowed, so a secret can rotate
// without a gap: sign with both the old and the new secret for a while.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX = 'whsec_';
export const TOLERANCE_SECONDS = 5 * 60;

export function newSecret(): string {
  return PREFIX + randomBytes(24).toString('base64');
}

function keyOf(secret: string): Buffer {
  return Buffer.from(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, 'base64');
}

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

export function signatureHeaders(
  secrets: string[],
  id: string,
  body: string,
  now: number = Date.now(),
): Record<string, string> {
  const timestamp = Math.floor(now / 1000);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': secrets.map((s) => sign(s, id, timestamp, body)).join(' '),
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verify(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  now: number = Date.now(),
): VerifyResult {
  const id = String(headers['webhook-id'] ?? '');
  const ts = Number(headers['webhook-timestamp']);
  const sigs = String(headers['webhook-signature'] ?? '');
  if (!id || !Number.isFinite(ts) || !sigs) return { ok: false, reason: 'missing headers' };
  if (Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp too old or in the future' };
  const expected = Buffer.from(sign(secret, id, ts, body));
  for (const candidate of sigs.split(' ')) {
    const got = Buffer.from(candidate);
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no signature matches' };
}
