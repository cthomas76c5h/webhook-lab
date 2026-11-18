// Fake receivers on /receiver/:mode, so every failure an operator will meet
// in the wild can be triggered on demand. A real receiver keeps its own copy
// of the secret; the lab cheats and looks it up by URL.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { verify } from './signing.ts';
import { db, notify } from './store.ts';

export const RECEIVER_MODES: Record<string, string> = {
  ok: 'Answers 200 at once, like a healthy Zapier Catch Hook.',
  slow: 'Waits longer than our timeout, so no answer arrives.',
  flaky: 'Answers 503 twice for each event, then 200.',
  ratelimited: 'Answers 429 with Retry-After: 2 the first time for each event, then 200.',
  gone: 'Answers 410 Gone, as Zapier does after the Zap is deleted.',
  reject: 'Answers 400 unless the body has a phone field, like a CRM with a required field.',
  redirect: 'Answers 302 to another host.',
};

const seenIds = new Map<string, number>(); // webhook-id → times seen, per mode
const acked = new Set<string>();

export async function handleReceiver(mode: string, req: IncomingMessage, res: ServerResponse, body: string): Promise<void> {
  const webhookId = String(req.headers['webhook-id'] ?? '');
  const key = `${mode}:${webhookId}`;
  const count = (seenIds.get(key) ?? 0) + 1;
  seenIds.set(key, count);

  const url = `http://${req.headers.host}${req.url}`;
  // Several endpoints can share one fake receiver; a match with any of them counts.
  // During a rotation a receiver may still hold the old secret; it must also pass.
  const endpoints = [...db.endpoints.values()].filter((e) => e.url === url);
  let verified = endpoints.length ? 'INVALID: no signature matches' : 'INVALID: no endpoint has this address';
  for (const ep of endpoints) {
    const [current, previous] = ep.secrets;
    const check = verify(current!, req.headers, body);
    if (check.ok) { verified = 'valid (current secret)'; break; }
    if (previous && verify(previous, req.headers, body).ok) { verified = 'valid (previous secret)'; break; }
    if (check.reason !== 'no signature matches') verified = `INVALID: ${check.reason}`;
  }

  let status = 200;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let reply = JSON.stringify({ status: 'success', id: webhookId });

  switch (mode) {
    case 'slow':
      await new Promise((r) => setTimeout(r, 15_000));
      break;
    case 'flaky':
      if (count <= 2) [status, reply] = [503, '{"error":"try later"}'];
      break;
    case 'ratelimited':
      if (count === 1) {
        status = 429;
        headers['retry-after'] = '2';
        reply = '{"error":"slow down"}';
      }
      break;
    case 'gone':
      [status, reply] = [410, '{"error":"hook not found"}'];
      break;
    case 'reject': {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { /* stays empty */ }
      const phone = Object.entries(parsed).find(([k]) => k.toLowerCase().replace(/[^a-z]/g, '') === 'phone')?.[1];
      if (!phone) [status, reply] = [400, '{"error":"Phone is required"}'];
      break;
    }
    case 'redirect':
      status = 302;
      headers.location = 'https://example.com/elsewhere';
      reply = '';
      break;
  }

  // What a careful receiver does: remember ids it already accepted, and
  // answer 200 again without acting twice.
  const duplicate = acked.has(key);
  if (status >= 200 && status < 300) acked.add(key);

  db.received.unshift({
    at: Date.now(),
    mode,
    webhookId,
    verified,
    duplicate,
    answered: `HTTP ${status}`,
    body,
  });
  db.received.length = Math.min(db.received.length, 50);
  notify();
  if (!res.destroyed) {
    res.writeHead(status, headers);
    res.end(reply);
  }
}
