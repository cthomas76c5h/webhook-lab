// PROTOTYPE: webhook lab. Binds to 127.0.0.1 only; the /admin routes have no
// auth. Three surfaces on one port:
//   /admin/*     operator console API (the page in public/ uses it)
//   /v1/*        firm-facing REST-hook API, the shape a Zapier app would call
//   /receiver/*  fake receivers that behave like real ones on a bad day

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { checkShape, zapierHint, type AddressPolicy } from './address.ts';
import { replay, startDispatcher } from './dispatcher.ts';
import { sampleLead, standardBody, templateVars } from './lead.ts';
import { RETRY_SCHEDULE_MS } from './policy.ts';
import { registerOnboarding, seedSetups, setups, viewSetup } from './onboarding.ts';
import { handleReceiver, RECEIVER_MODES } from './receivers.ts';
import {
  addEndpoint, addFirm, bus, db, publish, removeEndpoint, reset, rotateSecret, updateEndpoint,
  type Firm, type LeadEvent,
} from './store.ts';
import { renderTemplate } from './template.ts';

const PORT = Number(process.env.PORT ?? 4040);
const TIME_SCALE = Number(process.env.TIME_SCALE ?? 600);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 5000);
const ADDRESS: AddressPolicy = { allowLocal: process.env.ALLOW_LOCAL_TARGETS !== 'false' };
const PUBLIC = join(import.meta.dirname, '..', 'public');
// Workshop notes outlive a restart: they are the meeting's output. Gitignored.
const WORKSHOP_FILE = join(import.meta.dirname, '..', 'workshop-notes.json');
const ORIGIN = `http://localhost:${PORT}`;

// ---------- helpers ----------

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parse(body: string): Record<string, unknown> {
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'body is not JSON');
  }
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required`);
  return v.trim();
}

function firmByKey(req: IncomingMessage): Firm {
  const key = String(req.headers['x-api-key'] ?? '');
  const firm = [...db.firms.values()].find((f) => f.apiKey === key);
  if (!firm) throw new HttpError(401, 'invalid API key');
  return firm;
}

function variantOf(v: unknown): 'full' | 'sparse' | number {
  return v === 'sparse' ? 'sparse' : typeof v === 'number' ? v : 'full';
}

function previewEvent(firm: Firm, variant: 'full' | 'sparse' | number): LeadEvent {
  return {
    id: 'evt_preview',
    firmId: firm.id,
    type: 'lead.created',
    createdAt: Date.now(),
    data: sampleLead(firm.name, variant) as unknown as Record<string, unknown>,
  };
}

function snapshot() {
  const events = db.events;
  return {
    config: { timeScale: TIME_SCALE, timeoutMs: TIMEOUT_MS, scheduleMs: RETRY_SCHEDULE_MS, origin: ORIGIN },
    modes: RECEIVER_MODES,
    firms: [...db.firms.values()],
    endpoints: [...db.endpoints.values()].map((e) => {
      const shape = checkShape(e.url, ADDRESS);
      return { ...e, hint: shape.ok ? zapierHint(shape.url) : shape.reason };
    }),
    deliveries: [...db.deliveries.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((d) => {
        const data = events.get(d.eventId)?.data as { full_name?: string; call_type?: string } | undefined;
        return {
          ...d,
          firmId: events.get(d.eventId)?.firmId ?? null,
          lead: `${data?.full_name || 'Unknown caller'} · ${data?.call_type || 'unclassified'}`,
        };
      }),
    received: db.received,
    setups: [...setups.values()].map(viewSetup),
  };
}

// ---------- routes ----------

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], body: string) => Promise<void> | void;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), h]);

route('GET', '/admin/state', (_q, res) => json(res, 200, snapshot()));

route('GET', '/admin/stream', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  let pending: NodeJS.Timeout | null = null;
  const send = () => {
    pending ??= setTimeout(() => {
      pending = null;
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    }, 80);
  };
  send();
  bus.on('change', send);
  req.on('close', () => bus.off('change', send));
});

route('POST', '/admin/firms', (_q, res, _p, body) => json(res, 201, addFirm(str(parse(body).name, 'name'))));

route('POST', '/admin/endpoints', (_q, res, _p, body) => {
  const b = parse(body);
  const firmId = str(b.firmId, 'firmId');
  if (!db.firms.has(firmId)) throw new HttpError(404, 'no such firm');
  const url = str(b.url, 'url');
  const shape = checkShape(url, ADDRESS);
  if (!shape.ok) throw new HttpError(422, `address: ${shape.reason}`);
  const recipe = typeof b.recipe === 'string' ? b.recipe : null;
  const template = typeof b.template === 'string' && b.template.trim() ? b.template : null;
  if (template) {
    const firm = db.firms.get(firmId)!;
    for (const v of ['full', 'sparse'] as const) {
      const r = renderTemplate(template, templateVars(previewEvent(firm, v), firm.name));
      if (!r.ok) throw new HttpError(422, `template: ${r.errors.join('; ')}`);
    }
  }
  json(res, 201, addEndpoint({ firmId, name: str(b.name, 'name'), url, source: 'manual', recipe, template }));
});

route('PATCH', '/admin/endpoints/:id', (_q, res, [id], body) => {
  const b = parse(body);
  const patch: Record<string, unknown> = {};
  if (typeof b.name === 'string') patch.name = b.name.trim();
  if (typeof b.url === 'string') {
    const shape = checkShape(b.url, ADDRESS);
    if (!shape.ok) throw new HttpError(422, `address: ${shape.reason}`);
    patch.url = b.url.trim();
  }
  if (b.template === null || typeof b.template === 'string') {
    const t = typeof b.template === 'string' && b.template.trim() ? b.template : null;
    if (t) {
      const ep = db.endpoints.get(id!);
      const firm = ep && db.firms.get(ep.firmId);
      // Validate against the sparse sample too: a template that only works when every field is filled is a trap.
      for (const v of ['full', 'sparse'] as const) {
        const r = renderTemplate(t, templateVars(previewEvent(firm!, v), firm!.name));
        if (!r.ok) throw new HttpError(422, `template: ${r.errors.join('; ')}`);
      }
    }
    patch.template = t;
  }
  if (b.status === 'active') Object.assign(patch, { status: 'active', disabledReason: null, consecutiveFailures: 0 });
  if (b.status === 'disabled') Object.assign(patch, { status: 'disabled', disabledReason: 'paused by staff' });
  if (typeof b.recipe === 'string') patch.recipe = b.recipe;
  const ep = updateEndpoint(id!, patch);
  if (!ep) throw new HttpError(404, 'no such endpoint');
  json(res, 200, ep);
});

route('DELETE', '/admin/endpoints/:id', (_q, res, [id]) => json(res, removeEndpoint(id!) ? 200 : 404, {}));

route('POST', '/admin/endpoints/:id/rotate', (_q, res, [id]) => {
  // Real overlap would be ~24h; scaled like retries.
  const ep = rotateSecret(id!, Math.round(86_400_000 / TIME_SCALE));
  if (!ep) throw new HttpError(404, 'no such endpoint');
  json(res, 200, ep);
});

route('POST', '/admin/endpoints/:id/preview', (_q, res, [id], body) => {
  const b = parse(body);
  const ep = db.endpoints.get(id!);
  if (!ep) throw new HttpError(404, 'no such endpoint');
  const firm = db.firms.get(ep.firmId)!;
  const event = previewEvent(firm, variantOf(b.variant));
  const template = typeof b.template === 'string' ? b.template : (ep.template ?? '');
  if (!template.trim()) {
    json(res, 200, { ok: true, body: JSON.stringify(standardBody(event), null, 2), errors: [], used: [], vars: Object.keys(templateVars(event, firm.name)) });
    return;
  }
  const r = renderTemplate(template, templateVars(event, firm.name));
  let pretty = r.body;
  if (r.ok) pretty = JSON.stringify(JSON.parse(r.body), null, 2);
  json(res, 200, { ...r, body: pretty, vars: Object.keys(templateVars(event, firm.name)) });
});

route('POST', '/admin/endpoints/:id/test', (_q, res, [id], body) => {
  const ep = db.endpoints.get(id!);
  if (!ep) throw new HttpError(404, 'no such endpoint');
  const firm = db.firms.get(ep.firmId)!;
  if (ep.status !== 'active') throw new HttpError(409, 'endpoint is disabled; turn it on first');
  const event = publish(firm.id, sampleLead(firm.name, variantOf(parse(body).variant)) as unknown as Record<string, unknown>, {
    test: true,
    onlyEndpointId: ep.id,
  });
  json(res, 202, { eventId: event.id });
});

route('POST', '/admin/calls', (_q, res, _p, body) => {
  const b = parse(body);
  const firm = db.firms.get(str(b.firmId, 'firmId'));
  if (!firm) throw new HttpError(404, 'no such firm');
  const variant = b.variant === 'sparse' ? 'sparse' : Math.floor(Math.random() * 3);
  json(res, 202, { eventId: publish(firm.id, sampleLead(firm.name, variant) as unknown as Record<string, unknown>).id });
});

route('POST', '/admin/deliveries/:id/replay', (_q, res, [id]) => {
  const d = db.deliveries.get(id!);
  if (!d) throw new HttpError(404, 'no such delivery');
  const ep = db.endpoints.get(d.endpointId);
  if (!ep || ep.status !== 'active') throw new HttpError(409, 'the endpoint is removed or disabled');
  json(res, 202, replay(id!));
});

route('POST', '/admin/reset', (_q, res) => {
  setups.clear();
  reset();
  seed();
  json(res, 200, {});
});

// A staff member leaves: the key is replaced, and every subscription made with
// the old key is switched off with that reason (review: revocation must say
// what happens to existing subscriptions).
route('POST', '/admin/firms/:id/revoke-key', (_q, res, [id]) => {
  const firm = db.firms.get(id!);
  if (!firm) throw new HttpError(404, 'no such firm');
  firm.apiKey = `ak_${randomBytes(18).toString('base64url')}`;
  for (const ep of db.endpoints.values()) {
    if (ep.firmId === firm.id && ep.source === 'rest-hook' && ep.status === 'active') {
      updateEndpoint(ep.id, { status: 'disabled', disabledReason: 'API key revoked; reconnect Zapier with the new key' });
    }
  }
  json(res, 200, { id: firm.id });
});

// ----- Workshop: staged situations and the room's notes -----

const firmAt = (i: number): Firm => {
  const firm = [...db.firms.values()][i];
  if (!firm) throw new HttpError(409, 'reset the lab first: the demo firms are missing');
  return firm;
};
const callFor = (firm: Firm) => publish(firm.id, sampleLead(firm.name, Math.floor(Math.random() * 3)) as unknown as Record<string, unknown>);

const SCENARIOS: Record<string, () => { open: string; note: string }> = {
  'normal-delivery': () => {
    callFor(firmAt(0));
    return { open: '/', note: 'Firm A: one call, one lead, accepted by its Zap.' };
  },
  'assisted-onboarding': () => ({
    open: '/onboard.html',
    note: 'Pick a firm in the queue. "Open as client" shows the review page the firm gets through its secure link.',
  }),
  'zapier-self-setup': () => ({ open: '/portal.html', note: 'Click "+ Add a connection" → Automation tool → Open Zapier → recipe → Send test intake.' }),
  'crm-rejects': () => {
    callFor(firmAt(1));
    return { open: '/ops.html', note: "Firm B's receiver refuses the lead: Phone is required. Fix the mapping, then Resend." };
  },
  'deleted-zap': () => {
    const firm = firmAt(0);
    addEndpoint({ firmId: firm.id, name: 'Old Zap (deleted by the firm)', url: `${ORIGIN}/receiver/gone`, source: 'manual', recipe: 'create-intake' });
    callFor(firm);
    return { open: '/ops.html', note: 'The Zap is gone: HTTP 410 switches the destination off after one try, with the reason.' };
  },
  'receiver-down': () => {
    const firm = firmAt(0);
    addEndpoint({ firmId: firm.id, name: 'Zap during an outage', url: `${ORIGIN}/receiver/flaky`, source: 'manual', recipe: 'create-intake' });
    callFor(firm);
    return { open: '/', note: 'Zapier answers 503 twice: the lead retries by itself and is accepted on the third try.' };
  },
  duplicate: () => {
    const done = [...db.deliveries.values()].find((d) => d.status === 'delivered' && !d.test);
    if (!done) throw new HttpError(409, 'no accepted lead yet: run "Normal delivery" first');
    replay(done.id);
    return { open: '/', note: 'Resend sends the same webhook-id; the receiver inbox flags it as a duplicate.' };
  },
  'revoke-key': () => {
    const firm = firmAt(0);
    if (![...db.endpoints.values()].some((e) => e.firmId === firm.id && e.source === 'rest-hook')) {
      addEndpoint({ firmId: firm.id, name: 'Zapier (subscribed by the app)', url: `${ORIGIN}/receiver/ok`, source: 'rest-hook', recipe: 'create-intake' });
    }
    firm.apiKey = `ak_${randomBytes(18).toString('base64url')}`;
    for (const ep of db.endpoints.values()) {
      if (ep.firmId === firm.id && ep.source === 'rest-hook') {
        updateEndpoint(ep.id, { status: 'disabled', disabledReason: 'API key revoked; reconnect Zapier with the new key' });
      }
    }
    return { open: '/portal.html', note: 'The key that made the subscription is revoked: the Zapier connection shows Needs attention.' };
  },
  'change-crm': () => {
    const firm = firmAt(0);
    addEndpoint({ firmId: firm.id, name: 'New CRM Zap (parallel run)', url: `${ORIGIN}/receiver/ok`, source: 'manual', recipe: 'create-intake' });
    callFor(firm);
    return { open: '/', note: 'Old and new destinations both get the lead. Pause the old one when the firm is happy.' };
  },
};

route('POST', '/admin/scenarios/:name', (_q, res, [name]) => {
  const run = SCENARIOS[name!];
  if (!run) throw new HttpError(404, 'unknown scenario');
  json(res, 200, run());
});

route('GET', '/admin/workshop', async (_q, res) => {
  const text = await readFile(WORKSHOP_FILE, 'utf8').catch(() => '{}');
  json(res, 200, JSON.parse(text));
});

route('PUT', '/admin/workshop', async (_q, res, _p, body) => {
  await writeFile(WORKSHOP_FILE, JSON.stringify(parse(body), null, 2));
  json(res, 200, {});
});

// ----- Firm-facing REST-hook API: what a Zapier app's trigger would call -----

route('GET', '/v1/me', (req, res) => {
  const firm = firmByKey(req);
  json(res, 200, { id: firm.id, name: firm.name });
});

route('POST', '/v1/hooks', (req, res, _p, body) => {
  const firm = firmByKey(req);
  const b = parse(body);
  const url = str(b.target_url, 'target_url');
  const shape = checkShape(url, ADDRESS);
  if (!shape.ok) throw new HttpError(422, `target_url: ${shape.reason}`);
  if (b.event !== undefined && b.event !== 'lead.created') throw new HttpError(422, 'unknown event');
  // Zapier keeps the returned id and sends it back on unsubscribe.
  const ep = addEndpoint({ firmId: firm.id, name: 'Zapier (subscribed by the app)', url, source: 'rest-hook' });
  json(res, 201, { id: ep.id });
});

route('DELETE', '/v1/hooks/:id', (req, res, [id]) => {
  const firm = firmByKey(req);
  const ep = db.endpoints.get(id!);
  if (!ep || ep.firmId !== firm.id) throw new HttpError(404, 'no such hook');
  removeEndpoint(ep.id);
  json(res, 200, {});
});

// Zapier's "perform list": sample rows for the Test step. Always full, so every field can be mapped.
route('GET', '/v1/samples/lead.created', (req, res) => {
  const firm = firmByKey(req);
  json(res, 200, [0, 1, 2].map((i) => standardBody({ ...previewEvent(firm, i), id: `evt_sample_${i}` })));
});

route('POST', '/receiver/:mode', async (req, res, [mode], body) => {
  if (!(mode! in RECEIVER_MODES)) throw new HttpError(404, 'unknown mode');
  await handleReceiver(mode!, req, res, body);
});

// ---------- server ----------

const TYPES: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN);
  try {
    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname);
      if (m && req.method === method) {
        const body = method === 'GET' ? '' : await readBody(req);
        await handler(req, res, m.slice(1).map(decodeURIComponent), body);
        return;
      }
    }
    if (req.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (/^[\w.-]+$/.test(file)) {
        const data = await readFile(join(PUBLIC, file)).catch(() => null);
        if (data) {
          res.writeHead(200, { 'content-type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` });
          res.end(data);
          return;
        }
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: (e as Error).message });
  }
});

// The stakeholder demo: one platform, two firms with different outcomes, and
// one exception the operator fixes without code (Firm B's body lacks a phone).
function seed(): void {
  const a = addFirm('Firm A · Rose & Associates (personal injury)');
  addEndpoint({ firmId: a.id, name: 'Clio Grow Zap', url: `${ORIGIN}/receiver/ok`, source: 'manual', recipe: 'create-intake' });
  const b = addFirm('Firm B · Patel Family Law');
  addEndpoint({
    firmId: b.id,
    name: 'Lawmatics Zap',
    url: `${ORIGIN}/receiver/reject`,
    source: 'manual',
    recipe: 'create-contact',
    template: '{\n  "Name": "{{full_name|default:\'Unknown caller\'}}",\n  "Matter": "{{call_type|default:\'General\'}}",\n  "Summary": "{{message}}"\n}',
  });
  // Firms part-way through operator-assisted onboarding, for the cockpit queue.
  const more = ['Rivera Law', 'Chen Family Law', 'Parker Law Group'].map((n) => addFirm(n));
  seedSetups([a, b, ...more], ORIGIN);
}

registerOnboarding({
  route,
  json,
  parse,
  fail: (status, message) => { throw new HttpError(status, message); },
  address: ADDRESS,
  origin: ORIGIN,
});

seed();
startDispatcher({ timeScale: TIME_SCALE, timeoutMs: TIMEOUT_MS, address: ADDRESS, userAgent: 'AnsweringAI-Webhooks/0.1 (prototype)' });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`webhook-lab on ${ORIGIN}  (TIME_SCALE=${TIME_SCALE}: retries run ${TIME_SCALE}x faster)`);
});
