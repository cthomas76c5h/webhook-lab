// Operator-assisted onboarding: the operator configures, the client
// authorises and approves, the system tests and delivers. One shared setup
// record per integration, versioned, with an approval history.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkShape, type AddressPolicy } from './address.ts';
import { sampleLead, templateVars } from './lead.ts';
import { addEndpoint, db, notify, publish, updateEndpoint, type LeadEvent } from './store.ts';
import { renderTemplate } from './template.ts';

export type Destination = 'zapier-catch' | 'zapier-app' | 'webhook';
export interface MapRow { from: string; to: string }

export interface SetupEvent { at: number; who: 'operator' | 'client' | 'system'; what: string }
export interface Approval { version: number; decision: 'approved' | 'changes'; by: string; comment: string; at: number }
/** The configuration real leads use. Edits make a draft revision; this stays put until activation. */
export interface ActiveRevision { version: number; recipe: string; crm: string; rows: MapRow[]; at: number }

export interface Setup {
  id: string;
  firmId: string;
  token: string; // the client's secure link; a real one expires and is single-firm
  destination: Destination;
  crm: string; // the CRM the Zap or webhook ends in, as the firm names it
  recipe: string;
  rows: MapRow[];
  version: number;
  sentVersion: number | null; // the version the client was asked to approve
  endpointId: string | null;
  testDeliveryId: string | null;
  clientConfirmedAt: number | null; // "we saw the record in the CRM", said on the call
  active: ActiveRevision | null; // null until first go-live
  // recipe/crm/rows/version above are the latest revision: the active one, or a draft ahead of it.
  approvals: Approval[];
  history: SetupEvent[];
  createdAt: number;
}

export const setups = new Map<string, Setup>();

export const RECIPE_ROWS: Record<string, MapRow[]> = {
  'create-intake': [
    { from: 'full_name', to: 'Contact name' }, { from: 'phone', to: 'Phone' }, { from: 'email', to: 'Email' },
    { from: 'call_type', to: 'Matter type' }, { from: 'message', to: 'Notes' }, { from: 'event_id', to: 'External ID' },
  ],
  'create-contact': [
    { from: 'first_name', to: 'First name' }, { from: 'last_name', to: 'Last name' }, { from: 'phone', to: 'Phone' },
    { from: 'email', to: 'Email' }, { from: 'message', to: 'Note' },
  ],
  'notify-staff': [{ from: 'full_name', to: 'Caller' }, { from: 'phone', to: 'Phone' }, { from: 'message', to: 'Message' }],
};

// Only a plain webhook takes our mapping as its body. With Zapier the mapping
// lives in the Zap: we can show the plan, not enforce or verify it.
export const enforced = (s: Setup) => s.destination === 'webhook';

export function rowsToTemplate(rows: MapRow[]): string {
  const body: Record<string, string> = {};
  for (const r of rows) if (r.from && r.to.trim()) body[r.to.trim()] = `{{${r.from}}}`;
  return JSON.stringify(body, null, 2);
}

const log = (s: Setup, who: SetupEvent['who'], what: string) => {
  s.history.unshift({ at: Date.now(), who, what });
  notify();
};

export function stateOf(s: Setup): { state: string; next: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  if (s.active?.version === s.version) return { state: 'Live', next: 'Watch the Delivery Center', tone: 'ok' };
  if (!s.endpointId) return { state: 'Connection needed', next: 'Send the secure link', tone: 'warn' };
  const approved = s.approvals.find((a) => a.version === s.version && a.decision === 'approved');
  const changes = s.approvals.find((a) => a.version === s.version && a.decision === 'changes');
  if (changes) return { state: 'Changes requested', next: 'Read the comment, update, resend', tone: 'bad' };
  if (!approved) {
    return s.sentVersion === s.version
      ? { state: 'Awaiting client approval', next: 'Follow up', tone: 'muted' }
      : { state: 'Draft', next: 'Send for approval', tone: 'muted' };
  }
  const test = s.testDeliveryId ? db.deliveries.get(s.testDeliveryId) : undefined;
  if (!test) return { state: 'Ready to test', next: 'Send a test lead', tone: 'warn' };
  if (test.status === 'failed' || test.status === 'cancelled') return { state: 'Test failed', next: 'Inspect the mapping', tone: 'bad' };
  if (test.status !== 'delivered') return { state: 'Testing', next: 'Wait a moment', tone: 'warn' };
  if (!s.clientConfirmedAt) return { state: 'Test accepted', next: 'Client confirms the record in the CRM', tone: 'warn' };
  return { state: 'Ready to go live', next: s.active ? `Activate version ${s.version}` : 'Confirm go-live', tone: 'ok' };
}

export function createSetup(input: { firmId: string; destination: Destination; crm: string; recipe: string; rows?: MapRow[]; note?: string }): Setup {
  const s: Setup = {
    id: `su_${randomBytes(6).toString('hex')}`,
    firmId: input.firmId,
    token: randomBytes(16).toString('base64url'),
    destination: input.destination,
    crm: input.crm,
    recipe: input.recipe,
    rows: input.rows ?? structuredClone(RECIPE_ROWS[input.recipe] ?? []),
    version: 1,
    sentVersion: null,
    endpointId: null,
    testDeliveryId: null,
    clientConfirmedAt: null,
    active: null,
    approvals: [],
    history: [],
    createdAt: Date.now(),
  };
  setups.set(s.id, s);
  log(s, 'operator', input.note ?? `Draft created: ${input.crm}, recipe ${input.recipe}`);
  return s;
}

function connect(s: Setup, url: string, source: 'manual' | 'rest-hook'): void {
  const ep = addEndpoint({
    firmId: s.firmId,
    name: `${s.crm} (${s.destination === 'webhook' ? 'Webhook' : 'Zapier'})`,
    url,
    source,
    recipe: s.recipe,
    template: enforced(s) ? rowsToTemplate(s.rows) : null,
  });
  updateEndpoint(ep.id, { stage: 'setup' });
  s.endpointId = ep.id;
}

function sendTest(s: Setup): void {
  const firm = db.firms.get(s.firmId)!;
  // The test carries the revision's own body, so a draft is tested without touching the live template.
  const event = publish(firm.id, sampleLead(firm.name, 0) as unknown as Record<string, unknown>, {
    test: true,
    onlyEndpointId: s.endpointId!,
    template: enforced(s) ? rowsToTemplate(s.rows) : undefined,
  });
  s.testDeliveryId = [...db.deliveries.values()].find((d) => d.eventId === event.id)?.id ?? null;
  s.clientConfirmedAt = null;
}

export function viewSetup(s: Setup) {
  return {
    ...s,
    ...stateOf(s),
    live: !!s.active,
    activeVersion: s.active?.version ?? null,
    revising: !!s.active && s.active.version !== s.version,
    enforced: enforced(s),
    firmName: db.firms.get(s.firmId)?.name ?? '',
    sample: sampleFor(s),
  };
}

/**
 * A new configuration version: earlier approvals no longer cover it. The
 * endpoint is not touched; real leads keep the active revision until activation.
 */
function bump(s: Setup, what: string, who: SetupEvent['who']): void {
  s.version += 1;
  s.testDeliveryId = null;
  s.clientConfirmedAt = null;
  const live = s.active ? `; live stays on version ${s.active.version} until this one is approved, tested and activated` : '';
  log(s, who, `${what} (now version ${s.version}${live})`);
}

function activate(s: Setup): void {
  const was = s.active?.version;
  updateEndpoint(s.endpointId!, {
    stage: 'live',
    recipe: s.recipe,
    ...(enforced(s) ? { template: rowsToTemplate(s.rows) } : {}),
  });
  s.active = { version: s.version, recipe: s.recipe, crm: s.crm, rows: structuredClone(s.rows), at: Date.now() };
  log(s, 'operator', was === undefined ? `Went live on approved version ${s.version}` : `Activated approved version ${s.version} (replaces version ${was})`);
}

export function sampleFor(s: Setup) {
  const firm = db.firms.get(s.firmId)!;
  const event: LeadEvent = { id: 'evt_sample', firmId: firm.id, type: 'lead.created', createdAt: Date.now(), data: sampleLead(firm.name, 0) as unknown as Record<string, unknown> };
  const vars = templateVars(event, firm.name);
  return s.rows.map((r) => ({ ...r, value: String(vars[r.from] ?? '') }));
}

type Route = (method: string, path: string, h: (req: IncomingMessage, res: ServerResponse, params: string[], body: string) => Promise<void> | void) => void;

export function registerOnboarding(deps: {
  route: Route;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  parse: (body: string) => Record<string, unknown>;
  fail: (status: number, message: string) => never;
  address: AddressPolicy;
  origin: string;
}): void {
  const { route, json, parse, fail, address, origin } = deps;
  const byId = (id: string) => setups.get(id) ?? fail(404, 'no such setup');
  const byToken = (t: string) => [...setups.values()].find((s) => s.token === t) ?? fail(404, 'this link is not valid');
  const view = viewSetup;

  route('GET', '/admin/setups', (_q, res) => json(res, 200, [...setups.values()].map(view)));

  route('POST', '/admin/setups', (_q, res, _p, body) => {
    const b = parse(body);
    const firmId = String(b.firmId ?? '');
    if (!db.firms.has(firmId)) fail(404, 'no such firm');
    const from = typeof b.cloneFrom === 'string' ? setups.get(b.cloneFrom) : undefined;
    const s = createSetup({
      firmId,
      destination: (['zapier-catch', 'zapier-app', 'webhook'].includes(String(b.destination)) ? b.destination : 'zapier-catch') as Destination,
      crm: String(b.crm || 'Clio Grow'),
      recipe: String(b.recipe || 'create-intake'),
      rows: from ? structuredClone(from.active?.rows ?? from.rows) : undefined, // a live setup's proven mapping, not its draft
      note: from ? `Draft created by cloning the mapping of ${db.firms.get(from.firmId)?.name}` : undefined,
    });
    json(res, 201, view(s));
  });

  route('PATCH', '/admin/setups/:id', (_q, res, [id], body) => {
    const s = byId(id!);
    const b = parse(body);
    const changed: string[] = [];
    if (typeof b.recipe === 'string' && b.recipe !== s.recipe) { s.recipe = b.recipe; changed.push(`recipe → ${b.recipe}`); }
    if (typeof b.crm === 'string' && b.crm !== s.crm) { s.crm = b.crm; changed.push(`CRM → ${b.crm}`); }
    if (Array.isArray(b.rows)) {
      const rows = (b.rows as MapRow[]).filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string');
      if (JSON.stringify(rows) !== JSON.stringify(s.rows)) { s.rows = rows; changed.push('field mapping updated'); }
    }
    if (changed.length) bump(s, changed.join('; '), 'operator');
    json(res, 200, view(s));
  });

  route('POST', '/admin/setups/:id/send', (_q, res, [id]) => {
    const s = byId(id!);
    if (!s.endpointId) fail(409, 'the client has not connected yet');
    s.sentVersion = s.version;
    log(s, 'operator', `Version ${s.version} sent to the client for approval`);
    json(res, 200, view(s));
  });

  route('POST', '/admin/setups/:id/test', (_q, res, [id]) => {
    const s = byId(id!);
    if (!s.endpointId) fail(409, 'not connected');
    if (!s.approvals.some((a) => a.version === s.version && a.decision === 'approved')) fail(409, 'the client has not approved this version');
    sendTest(s);
    log(s, 'operator', 'Test lead sent');
    json(res, 202, view(s));
  });

  route('POST', '/admin/setups/:id/confirm', (_q, res, [id]) => {
    const s = byId(id!);
    s.clientConfirmedAt = Date.now();
    log(s, 'operator', 'Client confirmed on the call: the test record is in their CRM');
    json(res, 200, view(s));
  });

  route('POST', '/admin/setups/:id/go-live', (_q, res, [id]) => {
    const s = byId(id!);
    if (stateOf(s).state !== 'Ready to go live') fail(409, `not ready: ${stateOf(s).state}`);
    activate(s);
    json(res, 200, view(s));
  });

  // ----- The client's secure link -----

  route('GET', '/client/setups/:token', (_q, res, [token]) => {
    const s = byToken(token!);
    json(res, 200, { ...view(s), token: undefined, endpointId: undefined, connected: !!s.endpointId });
  });

  route('POST', '/client/setups/:token/connect', (_q, res, [token], body) => {
    const s = byToken(token!);
    if (s.endpointId) fail(409, 'already connected');
    const b = parse(body);
    if (s.destination === 'zapier-app') {
      // Plays the subscribe call the Zapier app makes when the firm turns the Zap on.
      connect(s, `${origin}/receiver/ok`, 'rest-hook');
      log(s, 'client', 'Connected the Answering AI Zapier app');
    } else {
      const url = String(b.url ?? '');
      const shape = checkShape(url, address);
      if (!shape.ok) fail(422, `address: ${shape.reason}`);
      connect(s, url, 'manual');
      log(s, 'client', 'Pasted the hook address through the secure link');
    }
    json(res, 200, { ok: true });
  });

  route('POST', '/client/setups/:token/decision', (_q, res, [token], body) => {
    const s = byToken(token!);
    const b = parse(body);
    const decision = b.decision === 'approved' ? 'approved' : 'changes';
    const by = String(b.by ?? '').trim() || 'Firm administrator';
    const comment = String(b.comment ?? '').trim();
    if (decision === 'changes' && !comment) fail(422, 'say what should change');
    if (Number(b.version) !== s.version) fail(409, 'the setup changed while you were reading; reload to see the new version');
    s.approvals.unshift({ version: s.version, decision, by, comment, at: Date.now() });
    log(s, 'client', decision === 'approved' ? `${by} approved version ${s.version}` : `${by} asked for changes: ${comment}`);
    json(res, 200, { ok: true });
  });
}

/** Seed setups in each state so the queue shows the whole journey. */
export function seedSetups(firms: { id: string; name: string }[], origin: string): void {
  const [a, b, rivera, chen, parker] = firms;
  if (!a || !b || !rivera || !chen || !parker) return;
  // Firm A: already live, on its existing Catch Hook Zap.
  const live = createSetup({ firmId: a.id, destination: 'zapier-catch', crm: 'Clio Grow', recipe: 'create-intake' });
  live.endpointId = [...db.endpoints.values()].find((e) => e.firmId === a.id)?.id ?? null;
  live.sentVersion = 1;
  live.approvals.push({ version: 1, decision: 'approved', by: 'Office manager', comment: '', at: Date.now() });
  live.clientConfirmedAt = Date.now();
  live.active = { version: 1, recipe: live.recipe, crm: live.crm, rows: structuredClone(live.rows), at: Date.now() };
  live.history.unshift({ at: Date.now(), who: 'system', what: 'Imported from the V1 Catch Hook setup' });

  // Firm B: approved, but its test is refused (missing Phone in the body).
  const failing = createSetup({
    firmId: b.id, destination: 'webhook', crm: 'Lawmatics', recipe: 'create-contact',
    rows: [{ from: 'full_name', to: 'Name' }, { from: 'call_type', to: 'Matter' }, { from: 'message', to: 'Summary' }],
  });
  connect(failing, `${origin}/receiver/reject`, 'manual');
  failing.sentVersion = 1;
  failing.approvals.push({ version: 1, decision: 'approved', by: 'Managing partner', comment: '', at: Date.now() });
  sendTest(failing);
  failing.history.unshift({ at: Date.now(), who: 'operator', what: 'Test lead sent' });

  createSetup({ firmId: rivera.id, destination: 'zapier-app', crm: 'Lawmatics', recipe: 'create-intake' });

  const waiting = createSetup({ firmId: chen.id, destination: 'zapier-catch', crm: 'MyCase', recipe: 'create-contact' });
  connect(waiting, `${origin}/receiver/ok`, 'manual');
  waiting.sentVersion = 1;
  waiting.history.unshift({ at: Date.now(), who: 'operator', what: 'Version 1 sent to the client for approval' });

  const ready = createSetup({ firmId: parker.id, destination: 'zapier-catch', crm: 'Clio Grow', recipe: 'create-intake' });
  connect(ready, `${origin}/receiver/ok`, 'manual');
  ready.sentVersion = 1;
  ready.approvals.push({ version: 1, decision: 'approved', by: 'Office manager', comment: '', at: Date.now() });
  sendTest(ready);
  ready.clientConfirmedAt = Date.now();
  ready.history.unshift({ at: Date.now(), who: 'operator', what: 'Test lead sent; client confirmed the record in Clio Grow' });
  notify();
}
