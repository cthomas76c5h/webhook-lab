// What to do with each response. The point of the lab is to make these
// rules explicit and visible, because they decide what an operator sees.

export type Outcome =
  | { kind: 'delivered' }
  | { kind: 'retry'; reason: string; retryAfterMs?: number }
  | { kind: 'failed'; reason: string } // this delivery stops; the endpoint stays on
  | { kind: 'disable'; reason: string }; // the endpoint is gone; stop sending to it at all

export interface AttemptResponse {
  status?: number; // undefined: no HTTP answer (timeout, DNS, refused, TLS)
  error?: string;
  retryAfter?: string | null;
}

export function classify(r: AttemptResponse, now: number = Date.now()): Outcome {
  if (r.status === undefined) return { kind: 'retry', reason: r.error ?? 'no answer' };
  const s = r.status;
  if (s >= 200 && s < 300) return { kind: 'delivered' };
  // 410 Gone is the REST-hook convention for "unsubscribe me" (Zapier uses it
  // when a Zap or its trigger is deleted). Retrying it only makes noise.
  if (s === 410) return { kind: 'disable', reason: 'HTTP 410 Gone: the receiver removed this hook' };
  if (s === 408 || s === 425 || s === 429 || s >= 500) {
    return { kind: 'retry', reason: `HTTP ${s}`, retryAfterMs: parseRetryAfter(r.retryAfter, now) };
  }
  // 3xx is not followed: a redirect could point the lead somewhere we never vetted.
  if (s >= 300 && s < 400) return { kind: 'failed', reason: `HTTP ${s}: redirects are not followed` };
  return { kind: 'failed', reason: `HTTP ${s}: the receiver refused the body` };
}

export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

// Real schedule (ms): 5s, 1m, 5m, 30m, 2h, 6h, 12h — about 21 hours in all,
// long enough to ride out a receiver outage over a night. The lab divides
// by TIME_SCALE so a full run of retries takes seconds.
export const RETRY_SCHEDULE_MS = [5_000, 60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000];

export function nextDelayMs(
  attemptsSoFar: number,
  timeScale: number,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number | null {
  const base = RETRY_SCHEDULE_MS[attemptsSoFar - 1];
  if (base === undefined) return null; // out of attempts
  const jittered = base * (0.8 + random() * 0.4); // ±20%, so retries from one outage do not arrive together
  const wait = Math.max(jittered, retryAfterMs ?? 0);
  return Math.round(wait / timeScale);
}

// Consecutive dead deliveries before the endpoint is switched off.
export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 5;
