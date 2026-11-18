// PROTOTYPE: shared by the firm portal and the Delivery Center pages.

import React, { useEffect, useState } from 'react';
import htm from 'htm';

export const html = htm.bind(React.createElement);

export async function api(method, path, body, headers = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const leadNo = (eventId) => `#${eventId.slice(-6).toUpperCase()}`;
export const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** Live snapshot: one fetch, then server-sent updates. Re-renders each second for countdowns. */
export function useSnapshot() {
  const [state, setState] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => {
    api('GET', '/admin/state').then((s) => setState((cur) => cur ?? s)).catch(() => {});
    const es = new EventSource('/admin/stream');
    es.onmessage = (e) => setState(JSON.parse(e.data));
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => { es.close(); clearInterval(t); };
  }, []);
  return state;
}

export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const say = (message, bad = false) => {
    setToast({ message, bad });
    const live = document.getElementById('status');
    if (live) live.textContent = message;
  };
  const act = async (fn, ok) => {
    try { const r = await fn(); if (ok) say(ok); return r; } catch (e) { say(e.message, true); return null; }
  };
  const view = toast && html`<div className=${`toast ${toast.bad ? 'bad' : ''}`} role="status">${toast.message}</div>`;
  return { act, say, view };
}

// "Accepted" is the strongest claim we can prove: the receiver took the lead.
export const STATUS = {
  delivered: { label: 'Accepted', tone: 'ok' },
  pending: { label: 'Retrying', tone: 'warn' },
  delivering: { label: 'Sending', tone: 'warn' },
  failed: { label: 'Needs attention', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export function journey(d) {
  const sent = d.attempts.length > 0;
  const stopped = ['failed', 'cancelled'].includes(d.status);
  return [
    { label: 'Lead published', state: 'done' },
    { label: d.attempts.length > 1 ? `Sent (${d.attempts.length} tries)` : 'Sent', state: sent ? 'done' : 'now' },
    { label: 'Accepted by receiver', state: d.status === 'delivered' ? 'done' : stopped ? 'bad' : sent ? 'now' : 'todo' },
    { label: 'In the CRM', state: 'unknown', note: 'not visible to us' },
  ];
}

/** The receiver's own words when it gave any, else the code. */
export function problem(d) {
  const last = d.attempts.at(-1);
  if (!last) return d.reason ?? '';
  try {
    const body = JSON.parse(last.responseSnippet);
    const msg = body.error ?? body.message;
    if (typeof msg === 'string') return msg;
  } catch { /* not JSON */ }
  return last.status ? `HTTP ${last.status}` : (last.error ?? d.reason ?? '');
}

export function nextAction(d) {
  if (!['failed', 'cancelled'].includes(d.status)) return null;
  const s = d.attempts.at(-1)?.status ?? 0;
  if (s === 410 || /disabled|paused/.test(d.reason ?? '')) return 'The destination is off. Reconnect or turn it on, then Resend.';
  if (s >= 400 && s < 500) return 'The receiver refused the lead. Fix the mapping, then Resend.';
  if (s >= 300 && s < 400) return 'The address redirects. Check it with the firm.';
  if (/template/.test(d.reason ?? '')) return 'The mapping is broken. Fix it, then Resend.';
  if (/removed/.test(d.reason ?? '')) return 'The destination was removed. Nothing to do unless that was a mistake.';
  return 'The receiver did not answer after every retry. Resend when it is back.';
}

export function Journey({ d }) {
  return html`<ol className="journey" aria-label="Delivery journey">
    ${journey(d).map((s) => html`<li key=${s.label} className=${s.state}><span>${s.label}</span>${s.note && html`<small>${s.note}</small>`}</li>`)}
  </ol>`;
}

/** Connection status from evidence only (review: never from a checkbox or a sample request). */
export function connectionStatus(endpoint, deliveries) {
  if (endpoint.status !== 'active') return { label: 'Needs attention', tone: 'bad', why: endpoint.disabledReason };
  const real = deliveries.filter((d) => d.endpointId === endpoint.id && !d.test);
  if (real.slice(0, 3).some((d) => d.status === 'failed')) return { label: 'Needs attention', tone: 'bad', why: 'recent leads failed' };
  if (real.some((d) => d.status === 'delivered')) return { label: 'Delivering', tone: 'ok' };
  return { label: 'Waiting for first lead', tone: 'muted' };
}

export const RECIPES = {
  'create-intake': { label: 'Create new intake', help: 'A new intake or matter in the CRM for each qualified call.' },
  'create-contact': { label: 'Create or update contact', help: 'Add a contact, or update one with the same phone.' },
  'notify-staff': { label: 'Notify staff', help: 'Send a message to the team; nothing is created in the CRM.' },
};

// Answering AI fields a firm can map, with the label it sees.
export const SOURCE_FIELDS = {
  full_name: 'Caller name', first_name: 'First name', last_name: 'Last name', phone: 'Phone', email: 'Email',
  call_type: 'Practice area', message: 'Call summary', details: 'Intake answers', call_link: 'Call link',
  recording_link: 'Recording link', called_at: 'Call time', event_id: 'Lead ID (dedupe key)',
};

/** Rows of "our field → their field" become a body template. Nothing free-form for the firm to break. */
export function mappingToTemplate(rows) {
  const body = {};
  for (const r of rows) if (r.from && r.to.trim()) body[r.to.trim()] = `{{${r.from}}}`;
  return JSON.stringify(body, null, 2);
}

export function templateToMapping(template) {
  if (!template) return null;
  try {
    const obj = JSON.parse(template);
    const rows = Object.entries(obj).map(([to, v]) => ({ to, from: /^\{\{\s*([\w.]+)[^}]*\}\}$/.exec(String(v))?.[1] ?? '' }));
    return rows.every((r) => r.from) ? rows : null; // a hand-written template is not a simple mapping
  } catch {
    return null;
  }
}
