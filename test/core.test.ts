import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkShape } from '../src/address.ts';
import { classify, nextDelayMs, parseRetryAfter, RETRY_SCHEDULE_MS } from '../src/policy.ts';
import { newSecret, signatureHeaders, verify } from '../src/signing.ts';
import { renderTemplate } from '../src/template.ts';

test('a signed request verifies, a changed body does not', () => {
  const secret = newSecret();
  const h = signatureHeaders([secret], 'evt_1', '{"a":1}');
  assert.deepEqual(verify(secret, h, '{"a":1}'), { ok: true });
  assert.equal(verify(secret, h, '{"a":2}').ok, false);
});

test('during rotation either secret verifies', () => {
  const [oldS, newS] = [newSecret(), newSecret()];
  const h = signatureHeaders([newS, oldS], 'evt_1', 'x');
  assert.equal(verify(oldS, h, 'x').ok, true);
  assert.equal(verify(newS, h, 'x').ok, true);
});

test('an old timestamp is refused (replay protection)', () => {
  const s = newSecret();
  const h = signatureHeaders([s], 'evt_1', 'x', Date.now() - 10 * 60_000);
  assert.equal(verify(s, h, 'x').ok, false);
});

test('response classification', () => {
  assert.equal(classify({ status: 200 }).kind, 'delivered');
  assert.equal(classify({ status: 410 }).kind, 'disable');
  assert.equal(classify({ status: 429 }).kind, 'retry');
  assert.equal(classify({ status: 503 }).kind, 'retry');
  assert.equal(classify({ status: 400 }).kind, 'failed');
  assert.equal(classify({ status: 302 }).kind, 'failed');
  assert.equal(classify({ error: 'ECONNREFUSED' }).kind, 'retry');
});

test('Retry-After in seconds and as a date', () => {
  assert.equal(parseRetryAfter('3', 0), 3000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 0), 10_000);
  assert.equal(parseRetryAfter('soon', 0), undefined);
});

test('backoff respects Retry-After and runs out', () => {
  assert.equal(nextDelayMs(1, 1, 60_000, () => 0.5), 60_000);
  assert.equal(nextDelayMs(RETRY_SCHEDULE_MS.length + 1, 1), null);
});

test('template values are JSON-escaped', () => {
  const r = renderTemplate('{"n":"{{note}}"}', { note: 'line 1\n"quoted"' });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(r.body).n, 'line 1\n"quoted"');
});

test('template default fills an empty field; unknown field is an error', () => {
  assert.equal(JSON.parse(renderTemplate('{"t":"{{t|default:\'General\'}}"}', { t: '' }).body).t, 'General');
  assert.equal(renderTemplate('{"x":"{{nope}}"}', {}).ok, false);
});

test('a missing intake field renders empty or its default, not an error', () => {
  const r = renderTemplate('{"a":"{{intake.injuries}}","b":"{{intake.injuries|default:\'-\'}}"}', {});
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.body), { a: '', b: '-' });
});

test('address shape rules', () => {
  const strict = { allowLocal: false };
  assert.equal(checkShape('http://hooks.zapier.com/x', strict).ok, false);
  assert.equal(checkShape('https://user:pw@hooks.zapier.com/x', strict).ok, false);
  assert.equal(checkShape('https://hooks.zapier.com/hooks/catch/1/a/', strict).ok, true);
  assert.equal(checkShape('http://localhost:4040/receiver/ok', { allowLocal: true }).ok, true);
});
