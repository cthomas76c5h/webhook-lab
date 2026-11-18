// Where we may send a lead. A firm types or pastes this address, so it is
// untrusted: without a check, a hook could point at our own network (SSRF).
// The check runs at save time AND at send time, because DNS can change.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface AddressPolicy {
  allowLocal: boolean; // the lab's own fake receivers live on localhost
}

export type AddressCheck = { ok: true; url: URL } | { ok: false; reason: string };

function isPrivate(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const p = v4.split('.').map(Number);
  if (p.length !== 4) return false;
  const [a, b] = p as [number, number];
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) || // link-local, includes cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  );
}

export function checkShape(raw: string, policy: AddressPolicy): AddressCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a web address' };
  }
  const local = policy.allowLocal && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !local) return { ok: false, reason: 'must use https' };
  if (url.username || url.password) return { ok: false, reason: 'must not contain a user name or password' };
  return { ok: true, url };
}

export async function checkResolves(url: URL, policy: AddressPolicy): Promise<AddressCheck> {
  const local = policy.allowLocal && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (local) return { ok: true, url };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (ips.length === 0) return { ok: false, reason: `cannot resolve ${host}` };
  if (ips.some(isPrivate)) return { ok: false, reason: `${host} resolves to a private address` };
  return { ok: true, url };
}

/** Zapier-specific hint, not a rule: catch hooks and REST-hook subscriptions use different paths. */
export function zapierHint(url: URL): string | null {
  if (url.hostname !== 'hooks.zapier.com') return null;
  if (url.pathname.startsWith('/hooks/catch/')) return 'Zapier Catch Hook (pasted by hand)';
  if (url.pathname.startsWith('/hooks/standard/')) return 'Zapier REST hook (subscribed by a Zapier app)';
  return 'hooks.zapier.com, but not a hook path: the firm may have copied the wrong link';
}
