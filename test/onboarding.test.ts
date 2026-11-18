import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody } from '../src/dispatcher.ts';
import { registerOnboarding, rowsToTemplate, setups, stateOf } from '../src/onboarding.ts';
import { addFirm, db } from '../src/store.ts';

// Drive the onboarding routes without a server: collect the handlers, call them directly.
type Handler = (req: unknown, res: unknown, params: string[], body: string) => unknown;
const routes = new Map<string, Handler>();
class Fail extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
registerOnboarding({
  route: (method, path, h) => routes.set(`${method} ${path}`, h as Handler),
  json: () => {},
  parse: (body) => (body ? JSON.parse(body) : {}),
  fail: (status, message) => { throw new Fail(status, message); },
  address: { allowLocal: true },
  origin: 'http://localhost:0',
});
const call = (key: string, params: string[], body: unknown = {}) => routes.get(key)!(null, null, params, JSON.stringify(body));

function approveAndTest(id: string): void {
  const s = setups.get(id)!;
  call('POST /admin/setups/:id/send', [id]);
  call('POST /client/setups/:token/decision', [s.token], { decision: 'approved', by: 'Office manager', version: s.version });
  call('POST /admin/setups/:id/test', [id]);
  db.deliveries.get(s.testDeliveryId!)!.status = 'delivered'; // the receiver accepted it
  call('POST /admin/setups/:id/confirm', [id]);
}

test('editing a live setup makes a draft revision; live leads keep the active one until activation', () => {
  const firm = addFirm('Revision & Co');
  call('POST /admin/setups', [], { firmId: firm.id, destination: 'webhook', crm: 'Lawmatics', recipe: 'notify-staff' });
  const s = [...setups.values()].find((x) => x.firmId === firm.id)!;
  call('POST /client/setups/:token/connect', [s.token], { url: 'http://localhost:0/receiver/ok' });
  approveAndTest(s.id);
  call('POST /admin/setups/:id/go-live', [s.id]);
  assert.equal(stateOf(s).state, 'Live');
  const v1 = rowsToTemplate(s.rows);
  const ep = db.endpoints.get(s.endpointId!)!;
  assert.equal(ep.template, v1);

  // The edit: a new version that the live endpoint does not see.
  const rows = [...s.rows, { from: 'email', to: 'Email' }];
  call('PATCH /admin/setups/:id', [s.id], { rows });
  assert.equal(s.version, 2);
  assert.equal(s.active?.version, 1);
  assert.equal(ep.template, v1, 'live template unchanged by the edit');
  assert.equal(stateOf(s).state, 'Draft');
  assert.throws(() => call('POST /admin/setups/:id/go-live', [s.id]), (e: Fail) => e.status === 409);

  // The test of the draft carries the draft's body; production still uses v1.
  approveAndTest(s.id);
  const testDelivery = db.deliveries.get(s.testDeliveryId!)!;
  const built = buildBody(ep, testDelivery.eventId, testDelivery.template === undefined ? ep.template : testDelivery.template);
  assert.ok(built.ok && 'Email' in JSON.parse(built.body), 'test body uses the draft mapping');
  assert.equal(ep.template, v1);

  call('POST /admin/setups/:id/go-live', [s.id]);
  assert.equal(s.active?.version, 2);
  assert.equal(ep.template, rowsToTemplate(rows));
  assert.equal(stateOf(s).state, 'Live');
});

test('discarding a draft returns to the live revision and never reuses its version number', () => {
  const firm = addFirm('Discard LLP');
  call('POST /admin/setups', [], { firmId: firm.id, destination: 'webhook', crm: 'Clio Grow', recipe: 'notify-staff' });
  const s = [...setups.values()].find((x) => x.firmId === firm.id)!;
  call('POST /client/setups/:token/connect', [s.token], { url: 'http://localhost:0/receiver/ok' });
  approveAndTest(s.id);
  call('POST /admin/setups/:id/go-live', [s.id]);
  const liveRows = structuredClone(s.rows);
  const ep = db.endpoints.get(s.endpointId!)!;
  assert.throws(() => call('POST /admin/setups/:id/discard', [s.id]), (e: Fail) => e.status === 409, 'nothing to discard');

  // Draft v2, approved by the client, then discarded.
  call('PATCH /admin/setups/:id', [s.id], { rows: [...s.rows, { from: 'email', to: 'Email' }] });
  call('POST /admin/setups/:id/send', [s.id]);
  call('POST /client/setups/:token/decision', [s.token], { decision: 'approved', by: 'Partner', version: 2 });
  call('POST /admin/setups/:id/discard', [s.id]);
  assert.equal(s.version, 1);
  assert.deepEqual(s.rows, liveRows);
  assert.equal(stateOf(s).state, 'Live');
  assert.equal(ep.template, rowsToTemplate(liveRows));
  // A stale review page cannot approve the live version again.
  assert.throws(() => call('POST /client/setups/:token/decision', [s.token], { decision: 'approved', by: 'Partner', version: 1 }), (e: Fail) => e.status === 409);

  // The next draft is v3, and v2's approval does not cover it.
  call('PATCH /admin/setups/:id', [s.id], { rows: [...liveRows, { from: 'call_type', to: 'Matter' }] });
  assert.equal(s.version, 3);
  assert.equal(stateOf(s).state, 'Draft');
});
