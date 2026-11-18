// The delivery loop. Guarantees explored here:
// - At least once: a delivery is retried until a 2xx, a permanent refusal,
//   or the schedule runs out. Receivers dedupe on `webhook-id`.
// - One in flight per delivery, never parallel retries of the same event.
// - Every attempt is recorded with what was sent and what came back, so an
//   operator can answer "did the firm get it?" without reading logs.

import { checkResolves, checkShape, type AddressPolicy } from './address.ts';
import { standardBody, templateVars } from './lead.ts';
import { classify, DISABLE_AFTER_CONSECUTIVE_FAILURES, nextDelayMs } from './policy.ts';
import { signatureHeaders } from './signing.ts';
import { db, notify, type Attempt, type Delivery, type Endpoint } from './store.ts';
import { renderTemplate } from './template.ts';

export interface DispatcherOptions {
  timeScale: number;
  timeoutMs: number;
  address: AddressPolicy;
  userAgent: string;
}

export function buildBody(endpoint: Endpoint, eventId: string): { ok: true; body: string } | { ok: false; reason: string } {
  const event = db.events.get(eventId);
  if (!event) return { ok: false, reason: 'event missing' };
  if (!endpoint.template) return { ok: true, body: JSON.stringify(standardBody(event)) };
  const firm = db.firms.get(endpoint.firmId);
  const r = renderTemplate(endpoint.template, templateVars(event, firm?.name ?? ''));
  return r.ok ? { ok: true, body: r.body } : { ok: false, reason: `template: ${r.errors.join('; ')}` };
}

function activeSecrets(endpoint: Endpoint, now: number): string[] {
  if (endpoint.secrets.length > 1 && endpoint.previousSecretExpiresAt !== null && now > endpoint.previousSecretExpiresAt) {
    endpoint.secrets = [endpoint.secrets[0]!];
    endpoint.previousSecretExpiresAt = null;
  }
  return endpoint.secrets;
}

async function attempt(delivery: Delivery, opts: DispatcherOptions): Promise<void> {
  const endpoint = db.endpoints.get(delivery.endpointId);
  const finish = (status: Delivery['status'], reason: string | null) => {
    delivery.status = status;
    delivery.reason = reason;
    delivery.nextAttemptAt = null;
  };
  if (!endpoint) return finish('cancelled', 'endpoint removed');
  if (endpoint.status !== 'active') return finish('cancelled', `endpoint disabled: ${endpoint.disabledReason}`);

  const built = buildBody(endpoint, delivery.eventId);
  if (!built.ok) return finish('failed', built.reason); // a broken template never fixes itself on retry

  const n = delivery.attempts.length + 1;
  const started = Date.now();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': opts.userAgent,
    ...signatureHeaders(activeSecrets(endpoint, started), delivery.eventId, built.body, started),
  };
  const record: Attempt = {
    n,
    at: started,
    durationMs: 0,
    url: endpoint.url,
    requestHeaders: headers,
    requestBody: built.body,
    responseSnippet: '',
    outcome: '',
    nextAttemptInMs: null,
  };

  let status: number | undefined;
  let error: string | undefined;
  let retryAfter: string | null = null;
  const shape = checkShape(endpoint.url, opts.address);
  const resolved = shape.ok ? await checkResolves(shape.url, opts.address) : shape;
  if (!resolved.ok) {
    error = `address refused: ${resolved.reason}`;
  } else {
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: built.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      status = res.status;
      retryAfter = res.headers.get('retry-after');
      record.responseSnippet = (await res.text()).slice(0, 500);
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      error = err.name === 'TimeoutError' ? `no answer in ${opts.timeoutMs} ms` : (err.cause?.code ?? err.message);
    }
  }
  record.durationMs = Date.now() - started;
  record.status = status;
  record.error = error;
  delivery.attempts.push(record);

  // An address that fails the SSRF check is permanent, not retryable.
  const outcome = !resolved.ok ? { kind: 'failed' as const, reason: error! } : classify({ status, error, retryAfter });
  if (outcome.kind === 'delivered') {
    record.outcome = 'delivered';
    endpoint.consecutiveFailures = 0;
    return finish('delivered', null);
  }
  if (outcome.kind === 'disable') {
    record.outcome = 'endpoint disabled';
    endpoint.status = 'disabled';
    endpoint.disabledReason = outcome.reason;
    cancelPending(endpoint.id, `endpoint disabled: ${outcome.reason}`);
    return finish('failed', outcome.reason);
  }
  if (outcome.kind === 'retry') {
    const delay = nextDelayMs(n, opts.timeScale, outcome.retryAfterMs);
    if (delay !== null) {
      record.outcome = `retry: ${outcome.reason}`;
      record.nextAttemptInMs = delay;
      delivery.status = 'pending';
      delivery.reason = outcome.reason;
      delivery.nextAttemptAt = Date.now() + delay;
      return;
    }
    record.outcome = `gave up after ${n} attempts: ${outcome.reason}`;
  } else {
    record.outcome = `failed: ${outcome.reason}`;
  }
  finish('failed', outcome.reason);
  if (!delivery.test) {
    endpoint.consecutiveFailures += 1;
    if (endpoint.consecutiveFailures >= DISABLE_AFTER_CONSECUTIVE_FAILURES) {
      endpoint.status = 'disabled';
      endpoint.disabledReason = `${endpoint.consecutiveFailures} leads in a row failed`;
    }
  }
}

function cancelPending(endpointId: string, reason: string): void {
  for (const d of db.deliveries.values()) {
    if (d.endpointId === endpointId && d.status === 'pending') {
      d.status = 'cancelled';
      d.reason = reason;
      d.nextAttemptAt = null;
    }
  }
}

export function startDispatcher(opts: DispatcherOptions): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const d of db.deliveries.values()) {
      if (d.status !== 'pending' || d.nextAttemptAt === null || d.nextAttemptAt > now) continue;
      d.status = 'delivering';
      notify();
      void attempt(d, opts).finally(notify);
    }
  }, 100);
  return () => clearInterval(timer);
}

/** Send an event to an endpoint again as a new delivery (same event id, so receivers can dedupe). */
export function replay(deliveryId: string): Delivery | null {
  const old = db.deliveries.get(deliveryId);
  if (!old) return null;
  const fresh: Delivery = {
    ...old,
    id: `${old.id}_r${Date.now().toString(36)}`,
    status: 'pending',
    reason: null,
    attempts: [],
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  };
  db.deliveries.set(fresh.id, fresh);
  notify();
  return fresh;
}
