// PROTOTYPE: everything lives in memory and is gone on restart. The shapes are
// the thing being explored; a real service would put these in Postgres with
// the deliveries table acting as the outbox.

import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { newSecret } from './signing.ts';

export interface Firm {
  id: string;
  name: string;
  apiKey: string;
}

export type EndpointSource = 'manual' | 'rest-hook';

export interface Endpoint {
  id: string;
  firmId: string;
  name: string;
  url: string;
  source: EndpointSource;
  // Signing secrets, newest first. During a rotation the old one stays until
  // `previousSecretExpiresAt`, and both sign every request.
  secrets: string[];
  previousSecretExpiresAt: number | null;
  events: string[];
  recipe: string | null; // what the firm chose should happen; a label only in the lab
  template: string | null; // null: the standard body
  status: 'active' | 'disabled';
  // 'setup': onboarding not finished; only test leads go here.
  stage: 'setup' | 'live';
  disabledReason: string | null;
  consecutiveFailures: number;
  createdAt: number;
}

export interface LeadEvent {
  id: string; // also the webhook-id header: the receiver's dedupe key
  firmId: string;
  type: 'lead.created';
  createdAt: number;
  data: Record<string, unknown>;
}

export interface Attempt {
  n: number;
  at: number;
  durationMs: number;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  status?: number;
  error?: string;
  responseSnippet: string;
  outcome: string;
  nextAttemptInMs: number | null;
}

export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed' | 'cancelled';

export interface Delivery {
  id: string;
  eventId: string;
  endpointId: string;
  test: boolean;
  // Set on a test of a draft revision: the body template under test. Absent:
  // the endpoint's own (live) template.
  template?: string | null;
  status: DeliveryStatus;
  reason: string | null;
  attempts: Attempt[];
  nextAttemptAt: number | null;
  createdAt: number;
}

export interface ReceivedRequest {
  at: number;
  mode: string;
  webhookId: string;
  verified: string;
  duplicate: boolean;
  answered: string;
  body: string;
}

export const bus = new EventEmitter();
const changed = () => bus.emit('change');

export const db = {
  firms: new Map<string, Firm>(),
  endpoints: new Map<string, Endpoint>(),
  events: new Map<string, LeadEvent>(),
  deliveries: new Map<string, Delivery>(),
  received: [] as ReceivedRequest[],
};

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export function addFirm(name: string): Firm {
  const firm = { id: id('firm'), name, apiKey: `ak_${randomBytes(18).toString('base64url')}` };
  db.firms.set(firm.id, firm);
  changed();
  return firm;
}

export function addEndpoint(input: {
  firmId: string;
  name: string;
  url: string;
  source: EndpointSource;
  template?: string | null;
  recipe?: string | null;
}): Endpoint {
  const endpoint: Endpoint = {
    id: id('ep'),
    firmId: input.firmId,
    name: input.name,
    url: input.url,
    source: input.source,
    secrets: [newSecret()],
    previousSecretExpiresAt: null,
    events: ['lead.created'],
    recipe: input.recipe ?? null,
    template: input.template ?? null,
    status: 'active',
    stage: 'live',
    disabledReason: null,
    consecutiveFailures: 0,
    createdAt: Date.now(),
  };
  db.endpoints.set(endpoint.id, endpoint);
  changed();
  return endpoint;
}

export function updateEndpoint(endpointId: string, patch: Partial<Endpoint>): Endpoint | null {
  const endpoint = db.endpoints.get(endpointId);
  if (!endpoint) return null;
  Object.assign(endpoint, patch);
  changed();
  return endpoint;
}

export function removeEndpoint(endpointId: string): boolean {
  const ok = db.endpoints.delete(endpointId);
  for (const d of db.deliveries.values()) {
    if (d.endpointId === endpointId && (d.status === 'pending' || d.status === 'delivering')) {
      d.status = 'cancelled';
      d.reason = 'endpoint removed';
      d.nextAttemptAt = null;
    }
  }
  changed();
  return ok;
}

export function rotateSecret(endpointId: string, overlapMs: number): Endpoint | null {
  const endpoint = db.endpoints.get(endpointId);
  if (!endpoint) return null;
  endpoint.secrets = [newSecret(), endpoint.secrets[0]!];
  endpoint.previousSecretExpiresAt = Date.now() + overlapMs;
  changed();
  return endpoint;
}

/** Record the event once, then fan out one delivery per active subscribed endpoint. */
export function publish(firmId: string, data: Record<string, unknown>, opts: { test?: boolean; onlyEndpointId?: string; template?: string | null } = {}): LeadEvent {
  const event: LeadEvent = { id: id('evt'), firmId, type: 'lead.created', createdAt: Date.now(), data };
  db.events.set(event.id, event);
  for (const ep of db.endpoints.values()) {
    if (ep.firmId !== firmId || ep.status !== 'active' || !ep.events.includes(event.type)) continue;
    if (opts.onlyEndpointId && ep.id !== opts.onlyEndpointId) continue;
    if (ep.stage === 'setup' && !opts.test) continue;
    const d = enqueue(event.id, ep.id, opts.test ?? false);
    if (opts.template !== undefined) d.template = opts.template;
  }
  changed();
  return event;
}

export function enqueue(eventId: string, endpointId: string, test: boolean): Delivery {
  const delivery: Delivery = {
    id: id('dlv'),
    eventId,
    endpointId,
    test,
    status: 'pending',
    reason: null,
    attempts: [],
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  };
  db.deliveries.set(delivery.id, delivery);
  changed();
  return delivery;
}

export function notify(): void {
  changed();
}

export function reset(): void {
  db.firms.clear();
  db.endpoints.clear();
  db.events.clear();
  db.deliveries.clear();
  db.received.length = 0;
  changed();
}
