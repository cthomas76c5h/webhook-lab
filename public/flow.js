// PROTOTYPE: canvas view of the webhook lab, in the style of the admin call
// flow editor (React Flow + dagre). The server's snapshot arrives over SSE;
// node positions and sizes are a per-browser convenience in localStorage.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background, ControlButton, Controls, Handle, MiniMap, NodeResizer, Position, ReactFlow,
  ReactFlowProvider, MarkerType, useNodesState, useReactFlow,
} from '@xyflow/react';
import dagre from 'dagre';
import htm from 'htm';

const html = htm.bind(React.createElement);
const DRAG_MIME = 'application/x-webhook-lab';

// ---------- small helpers ----------

async function api(method, path, body, headers = {}) {
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
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
const pretty = (text) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };
const modeOf = (url) => /\/receiver\/([\w-]+)$/.exec(url)?.[1] ?? null;
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } },
};

const Lab = createContext(null);
const useLab = () => useContext(Lab);

// ---------- graph from the snapshot ----------

const SIZE = { firm: [280, 190], zapier: [270, 170], endpoint: [330, 250], receiver: [290, 220] };

function deliveryStats(state, endpointId) {
  const list = state.deliveries.filter((d) => d.endpointId === endpointId);
  const count = (s) => list.filter((d) => d.status === s).length;
  return {
    list,
    delivered: count('delivered'),
    failed: count('failed') + count('cancelled'),
    pending: count('pending') + count('delivering'),
    last: list[0] ?? null,
  };
}

function edgeLook(last, endpoint) {
  if (endpoint.status !== 'active') return { color: 'var(--bad)', label: 'off', animated: false };
  if (!last) return { color: 'var(--line-strong)', label: 'waiting for a lead', animated: false };
  const a = last.attempts.at(-1);
  if (last.status === 'delivering') return { color: 'var(--warn)', label: 'sending…', animated: true };
  if (last.status === 'pending') {
    const s = last.nextAttemptAt ? Math.max(0, Math.ceil((last.nextAttemptAt - Date.now()) / 1000)) : 0;
    return { color: 'var(--warn)', label: a ? `${a.status ?? 'no answer'} · retry in ${s}s` : 'queued', animated: true };
  }
  if (last.status === 'delivered') return { color: 'var(--ok)', label: `HTTP ${a?.status ?? 200}`, animated: false };
  return { color: 'var(--bad)', label: a?.status ? `HTTP ${a.status}` : (last.reason ?? 'failed'), animated: false };
}

function buildGraph(state, firmId) {
  const firm = state?.firms.find((f) => f.id === firmId);
  if (!firm) return { nodes: [], edges: [] };
  const nodes = [];
  const edges = [];
  const eps = state.endpoints.filter((e) => e.firmId === firm.id);
  const subscribed = eps.filter((e) => e.source === 'rest-hook');

  nodes.push({ id: `firm:${firm.id}`, type: 'firm', data: { firm } });
  nodes.push({ id: `zapier:${firm.id}`, type: 'zapier', data: { firm, subscribed } });
  edges.push({
    id: `e-firm-zapier`, source: `firm:${firm.id}`, target: `zapier:${firm.id}`,
    label: 'API key', style: { strokeDasharray: '5 4' }, className: 'quiet-edge',
  });

  const receivers = new Map();
  for (const ep of eps) {
    const stats = deliveryStats(state, ep.id);
    nodes.push({ id: `ep:${ep.id}`, type: 'endpoint', data: { endpoint: ep, stats } });
    edges.push({
      id: `e-in-${ep.id}`,
      source: ep.source === 'rest-hook' ? `zapier:${firm.id}` : `firm:${firm.id}`,
      target: `ep:${ep.id}`,
      label: ep.source === 'rest-hook' ? 'subscribed' : 'lead.created',
      className: 'quiet-edge',
    });
    const rxId = `rx:${ep.url}`;
    if (!receivers.has(rxId)) receivers.set(rxId, ep.url);
    const look = edgeLook(stats.last, ep);
    edges.push({
      id: `e-out-${ep.id}`, source: `ep:${ep.id}`, target: rxId, label: look.label, animated: look.animated,
      style: { stroke: look.color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: look.color },
      labelStyle: { fill: look.color, fontWeight: 600 },
    });
  }
  for (const [id, url] of receivers) {
    const mode = modeOf(url);
    nodes.push({
      id, type: 'receiver',
      data: { url, mode, description: mode ? state.modes[mode] : null, received: mode ? state.received.filter((r) => r.mode === mode) : [] },
    });
  }
  return { nodes, edges };
}

function dagreLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 110, marginx: 20, marginy: 20 });
  const sizeOf = (n) => [n.measured?.width ?? n.width ?? SIZE[n.type][0], n.measured?.height ?? n.height ?? SIZE[n.type][1]];
  for (const n of nodes) { const [w, h] = sizeOf(n); g.setNode(n.id, { width: w, height: h }); }
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out = {};
  for (const n of nodes) { const p = g.node(n.id); const [w, h] = sizeOf(n); out[n.id] = { x: p.x - w / 2, y: p.y - h / 2 }; }
  return out;
}

// ---------- node components ----------

function Shell({ kind, chip, title, selected, resizable, minW = 240, minH = 140, children, onRename, warn }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const commit = () => { setEditing(false); if (draft.trim() && draft !== title) onRename?.(draft.trim()); };
  return html`
    <div className=${`node node-${kind} ${selected ? 'selected' : ''} ${warn ? 'warn' : ''}`}>
      ${resizable && html`<${NodeResizer} isVisible=${selected} minWidth=${minW} minHeight=${minH} lineClassName="resize-line" handleClassName="resize-handle" />`}
      <div className="node-head">
        <span className="node-chip">${chip}</span>
        ${editing
          ? html`<input className="nodrag rename" autoFocus value=${draft}
              onChange=${(e) => setDraft(e.target.value)} onBlur=${commit}
              onKeyDown=${(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
                if (e.key === 'Escape') { setDraft(title); setEditing(false); }
              }} aria-label="Name" />`
          : html`<span className="node-title" title=${onRename ? 'Double-click to rename' : title}
              onDoubleClick=${onRename ? () => setEditing(true) : undefined}>${title}</span>`}
      </div>
      <div className="node-body">${children}</div>
    </div>`;
}

function FirmNode({ data, selected }) {
  const { act } = useLab();
  const { firm } = data;
  return html`
    <${Shell} kind="firm" chip="Firm" title=${firm.name} selected=${selected}>
      <div className="muted small">Each finished call publishes one <code>lead.created</code> event.</div>
      <div className="row nodrag">
        <button className="btn primary" onClick=${() => act(() => api('POST', '/admin/calls', { firmId: firm.id }), 'Call ended: lead published')}>Simulate call</button>
        <button className="btn" onClick=${() => act(() => api('POST', '/admin/calls', { firmId: firm.id, variant: 'sparse' }), 'Hang-up: sparse lead published')}>Hang-up</button>
      </div>
    <//>
    <${Handle} type="source" position=${Position.Right} />`;
}

function ZapierNode({ data, selected }) {
  const { zapierCall } = useLab();
  const on = data.subscribed.length > 0;
  return html`
    <${Handle} type="target" position=${Position.Left} />
    <${Shell} kind="zapier" chip="Zapier app" title=${on ? `Zap on (${data.subscribed.length})` : 'No Zap connected'} selected=${selected}>
      <div className="muted small">Zapier subscribes and unsubscribes by itself. Nobody copies a URL.</div>
      <div className="row nodrag">
        <button className="btn" onClick=${() => zapierCall('subscribe')}>Turn Zap on</button>
        <button className="btn" disabled=${!on} onClick=${() => zapierCall('unsubscribe')}>Turn off</button>
        <button className="btn" onClick=${() => zapierCall('samples')}>Test step</button>
      </div>
    <//>
    <${Handle} type="source" position=${Position.Right} />`;
}

function EndpointNode({ id, data, selected }) {
  const { act, openPanel } = useLab();
  const { endpoint: e, stats } = data;
  const rename = (name) => act(() => api('PATCH', `/admin/endpoints/${e.id}`, { name }), 'Renamed');
  return html`
    <${Handle} type="target" position=${Position.Left} />
    <${Shell} kind="endpoint" chip=${e.status === 'active' ? 'Endpoint' : 'Endpoint · off'} title=${e.name}
      selected=${selected} resizable minW=${280} minH=${190} onRename=${rename} warn=${e.status !== 'active'}>
      <div className="mono small ellipsis" title=${e.url}>${e.url}</div>
      <div className="chips">
        <span className="chip">${e.source === 'rest-hook' ? 'subscribed by app' : 'pasted by hand'}</span>
        ${e.template && html`<span className="chip">custom body</span>`}
        ${e.secrets.length > 1 && html`<span className="chip warn">rotating secret</span>`}
      </div>
      ${e.disabledReason && html`<div className="banner bad">${e.disabledReason}</div>`}
      <div className="stats">
        <span className="ok">✓ ${stats.delivered}</span>
        <span className="warn">⟳ ${stats.pending}</span>
        <span className="bad">✗ ${stats.failed}</span>
      </div>
      <ol className="mini-log nowheel">
        ${stats.list.slice(0, 12).map((d) => html`
          <li key=${d.id} className=${d.status}>
            <span className="dot"></span>
            <span className="ellipsis">${d.lead}</span>
            <span className="muted">${d.attempts.length ? (d.attempts.at(-1).status ?? '—') : '…'}</span>
          </li>`)}
      </ol>
      <div className="row nodrag">
        ${e.status === 'active'
          ? html`<button className="btn" onClick=${() => act(() => api('POST', `/admin/endpoints/${e.id}/test`, {}), 'Sample lead queued')}>Sample</button>`
          : html`<button className="btn primary" onClick=${() => act(() => api('PATCH', `/admin/endpoints/${e.id}`, { status: 'active' }), 'Endpoint on')}>Turn on</button>`}
        <button className="btn" onClick=${() => openPanel(id, 'body')}>Body…</button>
        <button className="btn" onClick=${() => openPanel(id, 'log')}>Log</button>
      </div>
    <//>
    <${Handle} type="source" position=${Position.Right} />`;
}

function ReceiverNode({ data, selected }) {
  const { url, mode, description, received } = data;
  return html`
    <${Handle} type="target" position=${Position.Left} />
    <${Shell} kind=${mode ? 'receiver' : 'external'} chip=${mode ? 'Fake receiver' : 'External'} title=${mode ?? hostOf(url)}
      selected=${selected} resizable minW=${240} minH=${150}>
      <div className="muted small">${description ?? url}</div>
      ${mode
        ? html`<ol className="mini-log nowheel">
            ${received.slice(0, 12).map((r, i) => html`
              <li key=${i} className=${r.answered === 'HTTP 200' ? 'delivered' : 'failed'}>
                <span className="dot"></span>
                <span className="ellipsis">${r.answered}${r.duplicate ? ' · duplicate' : ''}</span>
                <span className=${r.verified.startsWith('valid') ? 'muted' : 'bad'}>${r.verified.startsWith('valid') ? 'signed ✓' : 'bad sig'}</span>
              </li>`)}
            ${received.length === 0 && html`<li className="muted">Nothing received yet.</li>`}
          </ol>`
        : html`<div className="muted small">A real address. The lab cannot see what it receives.</div>`}
    <//>`;
}

const nodeTypes = { firm: FirmNode, zapier: ZapierNode, endpoint: EndpointNode, receiver: ReceiverNode };

// ---------- side panel ----------

function Panel({ state, selected, tab, setTab, firm, zapOut, onClose }) {
  if (!selected) {
    return html`<div className="panel-empty">
      <h2>Build a delivery path</h2>
      <ol>
        <li>Drag a receiver from the left onto the canvas. That creates an endpoint for this firm.</li>
        <li>Click <strong>Simulate call</strong> on the Firm card and watch the lines.</li>
        <li>Select a card to edit it. Drag the corners to resize. Double-click a name to rename.</li>
        <li><strong>Auto layout</strong> tidies the canvas.</li>
      </ol>
      ${zapOut && html`<h3>Last Zapier app call</h3><pre className="out">${zapOut}</pre>`}
    </div>`;
  }
  if (selected.type === 'endpoint') {
    const ep = state.endpoints.find((e) => `ep:${e.id}` === selected.id);
    if (!ep) return null;
    return html`
      <div className="panel-head">
        <h2>${ep.name}</h2>
        <button className="btn icon" aria-label="Close" onClick=${onClose}>✕</button>
      </div>
      <div className="tabs" role="tablist">
        ${['settings', 'body', 'log'].map((t) => html`
          <button key=${t} role="tab" aria-selected=${tab === t} className=${`tab ${tab === t ? 'on' : ''}`} onClick=${() => setTab(t)}>
            ${{ settings: 'Settings', body: 'Body', log: 'Deliveries' }[t]}
          </button>`)}
      </div>
      ${tab === 'settings' && html`<${EndpointSettings} key=${ep.id} ep=${ep} />`}
      ${tab === 'body' && html`<${BodyEditor} key=${ep.id} ep=${ep} />`}
      ${tab === 'log' && html`<${DeliveryList} rows=${state.deliveries.filter((d) => d.endpointId === ep.id)} />`}`;
  }
  if (selected.type === 'receiver') {
    const mode = modeOf(selected.data.url);
    return html`
      <div className="panel-head"><h2>${mode ?? hostOf(selected.data.url)}</h2><button className="btn icon" aria-label="Close" onClick=${onClose}>✕</button></div>
      <p className="muted">${selected.data.description ?? selected.data.url}</p>
      <${Inbox} rows=${state.received.filter((r) => r.mode === mode)} />`;
  }
  return html`
    <div className="panel-head"><h2>${firm?.name}</h2><button className="btn icon" aria-label="Close" onClick=${onClose}>✕</button></div>
    <dl className="kv"><dt>API key</dt><dd><code>${firm?.apiKey}</code></dd></dl>
    <p className="muted small">The firm pastes this key into the Zapier app once. The app then calls <code>/v1/hooks</code> to subscribe.</p>
    ${zapOut && html`<h3>Last Zapier app call</h3><pre className="out">${zapOut}</pre>`}`;
}

function EndpointSettings({ ep }) {
  const { act } = useLab();
  const [name, setName] = useState(ep.name);
  const [url, setUrl] = useState(ep.url);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try { await api('PATCH', `/admin/endpoints/${ep.id}`, { name, url }); act(async () => {}, 'Saved'); }
    catch (err) { setError(err.message); }
  };
  return html`
    <form className="stack" onSubmit=${save}>
      <label className="field">Name<input value=${name} required onChange=${(e) => setName(e.target.value)} /></label>
      <label className="field">Address
        <input value=${url} type="url" required aria-invalid=${error ? 'true' : 'false'} aria-describedby=${error ? 'url-err' : undefined}
          onChange=${(e) => { setUrl(e.target.value); setError(''); }} />
      </label>
      ${error && html`<p id="url-err" className="bad small">${error}</p>`}
      ${ep.hint && html`<p className="muted small">${ep.hint}</p>`}
      <div className="row"><button className="btn primary" type="submit">Save</button></div>
      <h3>Signing secret</h3>
      ${ep.secrets.map((s, i) => html`<code key=${i} className="secret">${i === 0 ? 'current ' : 'previous '}${s}</code>`)}
      <div className="row">
        <button type="button" className="btn" onClick=${() => act(() => api('POST', `/admin/endpoints/${ep.id}/rotate`), 'Rotated: both secrets sign for the overlap')}>Rotate secret</button>
        ${ep.status === 'active'
          ? html`<button type="button" className="btn" onClick=${() => act(() => api('POST', `/admin/endpoints/${ep.id}/test`, {}), 'Sample lead queued')}>Send sample lead</button>`
          : html`<button type="button" className="btn primary" onClick=${() => act(() => api('PATCH', `/admin/endpoints/${ep.id}`, { status: 'active' }), 'Endpoint on')}>Turn on</button>`}
        <button type="button" className="btn danger" onClick=${() => { if (confirm(`Remove "${ep.name}"?`)) act(() => api('DELETE', `/admin/endpoints/${ep.id}`), 'Endpoint removed'); }}>Remove</button>
      </div>
    </form>`;
}

const PRESET = `{
  "First Name": "{{first_name}}",
  "Last Name": "{{last_name}}",
  "Phone": "{{phone}}",
  "Email": "{{email}}",
  "Practice Area": "{{call_type|default:'General'}}",
  "Lead Source": "{{source}}",
  "Notes": "{{message}}\\n\\n{{details}}\\n\\nCall: {{call_link}}",
  "Dedupe Key": "{{event_id}}"
}`;

function BodyEditor({ ep }) {
  const { act } = useLab();
  const [template, setTemplate] = useState(ep.template ?? '');
  const [variant, setVariant] = useState('full');
  const [result, setResult] = useState({ body: '', errors: [], used: [], vars: [] });
  const ref = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api('POST', `/admin/endpoints/${ep.id}/preview`, { template, variant })
        .then(setResult)
        .catch((e) => setResult({ body: '', errors: [e.message], used: [], vars: [] }));
    }, 180);
    return () => clearTimeout(t);
  }, [template, variant, ep.id]);
  const insert = (v) => {
    const el = ref.current;
    const token = `{{${v}}}`;
    if (!el) return setTemplate((t) => t + token);
    el.setRangeText(token, el.selectionStart, el.selectionEnd, 'end');
    setTemplate(el.value);
    el.focus();
  };
  return html`
    <div className="stack">
      <p className="muted small">Empty sends the standard body. <code>{{field}}</code>, <code>{{field|default:'x'}}</code>. Checked against a full lead and a hang-up before it saves.</p>
      <textarea ref=${ref} className="tpl" spellCheck=${false} value=${template} placeholder="Standard body"
        aria-invalid=${result.errors.length ? 'true' : 'false'} aria-label="Body template"
        onChange=${(e) => setTemplate(e.target.value)}></textarea>
      <div className="chips">
        ${result.vars.filter((v) => v !== 'schema_version').map((v) => html`
          <button key=${v} type="button" className=${`chip btn-chip ${result.used.includes(v) ? 'used' : ''}`} onClick=${() => insert(v)}>${v}</button>`)}
      </div>
      <div className="row between">
        <strong>Preview</strong>
        <select value=${variant} onChange=${(e) => setVariant(e.target.value)} aria-label="Sample">
          <option value="full">Full lead</option>
          <option value="sparse">Hang-up</option>
        </select>
      </div>
      <pre className="out">${result.body}</pre>
      ${result.errors.length > 0 && html`<ul className="bad small">${result.errors.map((e, i) => html`<li key=${i}>${e}</li>`)}</ul>`}
      <div className="row">
        <button className="btn" onClick=${() => setTemplate(PRESET)}>CRM-ready preset</button>
        <button className="btn" onClick=${() => setTemplate('')}>Standard body</button>
        <button className="btn primary" onClick=${() => act(() => api('PATCH', `/admin/endpoints/${ep.id}`, { template }), 'Body saved')}>Save body</button>
      </div>
    </div>`;
}

// A 2xx means the receiver (Zapier) accepted the lead, not that the CRM has it.
const STATUS_LABEL = { delivered: 'accepted', pending: 'retrying', delivering: 'sending', failed: 'failed', cancelled: 'cancelled' };

function journey(d) {
  const sent = d.attempts.length > 0;
  const stopped = ['failed', 'cancelled'].includes(d.status);
  return [
    { label: 'Lead published', state: 'done' },
    { label: d.attempts.length > 1 ? `Sent (${d.attempts.length} tries)` : 'Sent', state: sent ? 'done' : 'now' },
    { label: 'Accepted by receiver', state: d.status === 'delivered' ? 'done' : stopped ? 'bad' : sent ? 'now' : 'todo' },
    { label: 'In the CRM', state: 'unknown', note: 'not visible to us' },
  ];
}

function nextAction(d) {
  if (!['failed', 'cancelled'].includes(d.status)) return null;
  const last = d.attempts.at(-1);
  const s = last?.status ?? 0;
  if (s === 410 || /disabled/.test(d.reason ?? '')) return 'The receiver removed this hook. Ask the firm to reconnect, then Resend.';
  if (s >= 400 && s < 500) return `The receiver refused the body: ${last.responseSnippet || `HTTP ${s}`}. Fix the body or the firm's Zap, then Resend.`;
  if (s >= 300 && s < 400) return 'The address redirects. Check it with the firm.';
  if (/template/.test(d.reason ?? '')) return 'The body template is broken. Fix it under Body, then Resend.';
  if (/removed/.test(d.reason ?? '')) return 'The endpoint was removed. Nothing to do unless that was a mistake.';
  return 'The receiver did not answer after every retry. Resend when it is back.';
}

function DeliveryList({ rows, showEndpoint, endpoints }) {
  const { act } = useLab();
  if (!rows.length) return html`<p className="muted">Nothing sent yet.</p>`;
  return html`<div className="deliveries">
    ${rows.map((d) => html`
      <details key=${d.id} className=${`delivery ${d.status}`}>
        <summary>
          <span className="dot"></span>
          <span className="grow ellipsis">${d.lead}${d.test ? ' · sample' : ''}</span>
          ${showEndpoint && html`<span className="muted ellipsis">${endpoints.get(d.endpointId)?.name ?? '(removed)'}</span>`}
          <span className="muted">${STATUS_LABEL[d.status]} · ${d.attempts.length} ${d.attempts.length === 1 ? 'try' : 'tries'} · ${ago(d.createdAt)}</span>
          ${['failed', 'cancelled', 'delivered'].includes(d.status) &&
            html`<button className="btn small-btn" onClick=${(e) => { e.preventDefault(); act(() => api('POST', `/admin/deliveries/${d.id}/replay`), 'Resent with the same webhook-id'); }}>Resend</button>`}
        </summary>
        <ol className="journey" aria-label="Delivery journey">
          ${journey(d).map((s) => html`<li key=${s.label} className=${s.state}><span>${s.label}</span>${s.note && html`<small>${s.note}</small>`}</li>`)}
        </ol>
        ${nextAction(d) && html`<div className="banner bad"><strong>Next action:</strong> ${nextAction(d)}</div>`}
        ${d.attempts.map((a) => html`
          <div key=${a.n} className=${`attempt ${a.outcome === 'delivered' ? 'ok' : 'bad'}`}>
            <div><strong>#${a.n}</strong> ${a.status ? `HTTP ${a.status}` : a.error} · ${a.durationMs} ms · ${a.outcome}</div>
            <pre className="out">${Object.entries(a.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}${'\n\n'}${pretty(a.requestBody)}</pre>
            ${a.responseSnippet && html`<pre className="out">${a.responseSnippet}</pre>`}
          </div>`)}
      </details>`)}
  </div>`;
}

function Inbox({ rows }) {
  if (!rows.length) return html`<p className="muted">Nothing received yet.</p>`;
  return html`<div className="deliveries">
    ${rows.map((r, i) => html`
      <details key=${i} className=${`delivery ${r.answered === 'HTTP 200' ? 'delivered' : 'failed'}`}>
        <summary>
          <span className="dot"></span>
          <span className="grow mono ellipsis">${r.webhookId}</span>
          ${r.duplicate && html`<span className="chip warn">duplicate</span>`}
          <span className=${r.verified.startsWith('valid') ? 'muted' : 'bad'}>${r.verified}</span>
          <span className="muted">${r.mode} · ${r.answered} · ${ago(r.at)}</span>
        </summary>
        <pre className="out">${pretty(r.body)}</pre>
      </details>`)}
  </div>`;
}

// ---------- splitters ----------

function Splitter({ axis, value, onChange, min, max, label }) {
  const start = (e) => {
    e.preventDefault();
    const origin = axis === 'x' ? e.clientX : e.clientY;
    const initial = value;
    const move = (ev) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
      onChange(Math.min(max, Math.max(min, initial - delta)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const key = (e) => {
    const step = e.shiftKey ? 64 : 16;
    if (['ArrowLeft', 'ArrowUp'].includes(e.key)) onChange(Math.min(max, value + step));
    if (['ArrowRight', 'ArrowDown'].includes(e.key)) onChange(Math.max(min, value - step));
  };
  return html`<div className=${`splitter splitter-${axis}`} role="separator" tabIndex=${0} aria-label=${label}
    aria-orientation=${axis === 'x' ? 'vertical' : 'horizontal'} aria-valuenow=${value} aria-valuemin=${min} aria-valuemax=${max}
    onPointerDown=${start} onKeyDown=${key}></div>`;
}

// ---------- app ----------

function Canvas() {
  const [state, setState] = useState(null);
  const [firmId, setFirmId] = useState(() => store.get('webhook-lab:firm'));
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('settings');
  const [toast, setToast] = useState(null);
  const [zapOut, setZapOut] = useState('');
  const [panelW, setPanelW] = useState(() => store.get('webhook-lab:panelW') ?? 420);
  const [drawerH, setDrawerH] = useState(() => store.get('webhook-lab:drawerH') ?? 220);
  const [drawerTab, setDrawerTab] = useState('deliveries');
  const [, tick] = useState(0);
  const flow = useReactFlow();
  const layoutKey = `webhook-lab:layout:${firmId}`;

  useEffect(() => {
    api('GET', '/admin/state').then((s) => setState((cur) => cur ?? s)).catch(() => {});
    const es = new EventSource('/admin/stream');
    es.onmessage = (e) => setState(JSON.parse(e.data));
    return () => es.close();
  }, []);
  useEffect(() => {
    if (state && !state.firms.some((f) => f.id === firmId)) setFirmId(state.firms[0]?.id ?? null);
  }, [state, firmId]);
  useEffect(() => store.set('webhook-lab:firm', firmId), [firmId]);
  useEffect(() => store.set('webhook-lab:panelW', panelW), [panelW]);
  useEffect(() => store.set('webhook-lab:drawerH', drawerH), [drawerH]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const graph = useMemo(() => buildGraph(state, firmId), [state, firmId, Math.floor(Date.now() / 1000)]);

  // Merge the snapshot into React Flow's nodes, keeping position, size and measurements.
  useEffect(() => {
    const saved = store.get(layoutKey) ?? {};
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      const fresh = graph.nodes.filter((n) => !byId.has(n.id) && !saved[n.id]);
      const auto = fresh.length ? dagreLayout([...prev.filter((p) => graph.nodes.some((g) => g.id === p.id)), ...graph.nodes.filter((n) => !byId.has(n.id))], graph.edges) : {};
      return graph.nodes.map((n) => {
        const old = byId.get(n.id);
        if (old) return { ...old, data: n.data, type: n.type };
        const s = saved[n.id];
        return {
          ...n,
          position: s ? { x: s.x, y: s.y } : (pendingDrop.current[n.id] ?? auto[n.id] ?? { x: 0, y: 0 }),
          ...(s?.w ? { width: s.w, height: s.h } : {}),
          selected: n.id === selectedId,
        };
      });
    });
  }, [graph, layoutKey]);

  const pendingDrop = useRef({});

  const persist = useCallback((list) => {
    const out = {};
    for (const n of list) out[n.id] = { x: n.position.x, y: n.position.y, w: n.width, h: n.height };
    store.set(layoutKey, out);
  }, [layoutKey]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    if (changes.some((c) => (c.type === 'position' && c.dragging === false) || (c.type === 'dimensions' && c.resizing === false))) {
      setNodes((cur) => { persist(cur); return cur; });
    }
  }, [onNodesChange, persist, setNodes]);

  const autoLayout = useCallback(() => {
    setNodes((cur) => {
      const pos = dagreLayout(cur, graph.edges);
      const next = cur.map((n) => ({ ...n, position: pos[n.id] ?? n.position }));
      persist(next);
      return next;
    });
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300 }));
  }, [graph.edges, persist, setNodes, flow]);

  const say = useCallback((message, bad = false) => {
    setToast({ message, bad, at: Date.now() });
    const live = document.getElementById('status');
    if (live) live.textContent = message;
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(async (fn, ok) => {
    try { const r = await fn(); if (ok) say(ok); return r; } catch (e) { say(e.message, true); return null; }
  }, [say]);

  const firm = state?.firms.find((f) => f.id === firmId);
  const zapierCall = useCallback(async (what) => {
    if (!firm) return;
    const key = { 'x-api-key': firm.apiKey };
    if (what === 'subscribe') {
      const target_url = `${state.config.origin}/receiver/ok`;
      const r = await act(() => api('POST', '/v1/hooks', { target_url, event: 'lead.created' }, key), 'Zap on: the app subscribed');
      if (r) setZapOut(`POST /v1/hooks\n{ "target_url": "${target_url}" }\n\n→ ${JSON.stringify(r, null, 2)}`);
    } else if (what === 'unsubscribe') {
      const ep = state.endpoints.find((e) => e.firmId === firm.id && e.source === 'rest-hook');
      if (!ep) return;
      const r = await act(() => api('DELETE', `/v1/hooks/${ep.id}`, undefined, key), 'Zap off: the app unsubscribed');
      if (r) setZapOut(`DELETE /v1/hooks/${ep.id}\n\n→ 200`);
    } else {
      const r = await act(() => api('GET', '/v1/samples/lead.created', undefined, key));
      if (r) setZapOut(`GET /v1/samples/lead.created  (Zapier Test step)\n\n→ ${JSON.stringify(r, null, 2)}`);
    }
    setSelectedId(`zapier:${firm.id}`);
  }, [firm, state, act]);

  const openPanel = useCallback((id, t) => {
    setSelectedId(id);
    setTab(t);
    setNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === id })));
  }, [setNodes]);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw || !firm) return;
    const { mode, url } = JSON.parse(raw);
    const position = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const address = url ?? `${state.config.origin}/receiver/${mode}`;
    const ep = await act(() => api('POST', '/admin/endpoints', { firmId: firm.id, name: mode ? `Zap (${mode})` : 'New endpoint', url: address }), 'Endpoint added');
    if (!ep) return;
    pendingDrop.current[`ep:${ep.id}`] = position;
    if (!nodes.some((n) => n.id === `rx:${address}`)) pendingDrop.current[`rx:${address}`] = { x: position.x + 420, y: position.y };
    setNodes((cur) => cur.map((n) => (pendingDrop.current[n.id] ? { ...n, position: pendingDrop.current[n.id] } : n)));
    openPanel(`ep:${ep.id}`, 'settings');
  }, [firm, flow, state, act, nodes, setNodes, openPanel]);

  const onBeforeDelete = useCallback(async ({ nodes: gone }) => {
    for (const n of gone.filter((x) => x.type === 'endpoint')) {
      if (confirm(`Remove "${n.data.endpoint.name}"?`)) await act(() => api('DELETE', `/admin/endpoints/${n.data.endpoint.id}`), 'Endpoint removed');
    }
    return false; // the snapshot removes it
  }, [act]);

  if (!state) return html`<p className="boot">Connecting…</p>`;
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const endpointsById = new Map(state.endpoints.map((e) => [e.id, e]));
  const firmDeliveries = state.deliveries.filter((d) => endpointsById.get(d.endpointId)?.firmId === firmId || !endpointsById.has(d.endpointId));

  return html`
    <${Lab.Provider} value=${{ act, openPanel, zapierCall }}>
      <div className="app" style=${{ '--panel-w': `${panelW}px`, '--drawer-h': `${drawerH}px` }}>
        <header className="topbar">
          <div className="brand"><span className="logo">⇢</span> Webhook lab <span className="tag">prototype</span></div>
          <label className="firm-pick">Firm
            <select value=${firmId ?? ''} onChange=${(e) => { setFirmId(e.target.value); setSelectedId(null); }}>
              ${state.firms.map((f) => html`<option key=${f.id} value=${f.id}>${f.name}</option>`)}
            </select>
          </label>
          <div className="spacer"></div>
          <button className="btn primary" onClick=${() => act(() => api('POST', '/admin/calls', { firmId }), 'Call ended: lead published')}>Simulate call</button>
          <button className="btn" onClick=${() => act(() => api('POST', '/admin/calls', { firmId, variant: 'sparse' }), 'Hang-up: sparse lead published')}>Hang-up</button>
          <button className="btn" onClick=${autoLayout}>Auto layout</button>
          <button className="btn quiet" onClick=${() => { if (confirm('Reset the lab? Everything is wiped.')) act(() => api('POST', '/admin/reset'), 'Lab reset'); }}>Reset</button>
          <a className="btn quiet" href="/workshop.html">Workshop</a>
          <a className="btn quiet" href="/portal.html">Firm portal</a>
          <a className="btn quiet" href="/ops.html">Delivery Center</a>
          <a className="btn quiet" href="/classic.html">Classic view</a>
        </header>

        <aside className="palette" aria-label="Receivers">
          <h2>Receivers</h2>
          <p className="muted small">Drag one onto the canvas to add an endpoint.</p>
          ${Object.entries(state.modes).map(([mode, desc]) => html`
            <div key=${mode} className=${`palette-item mode-${mode}`} draggable="true"
              onDragStart=${(e) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ mode })); e.dataTransfer.effectAllowed = 'copy'; }}>
              <strong>${mode}</strong><span className="muted small">${desc}</span>
            </div>`)}
          <h2>Retry schedule</h2>
          <p className="muted small">${state.config.scheduleMs.map((ms) => (ms >= 3_600_000 ? `${ms / 3_600_000}h` : ms >= 60_000 ? `${ms / 60_000}m` : `${ms / 1000}s`)).join(' · ')}<br />Running ${state.config.timeScale}× faster.</p>
        </aside>

        <section className="canvas" onDragOver=${(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop=${onDrop}>
          <${ReactFlow}
            nodes=${nodes} edges=${graph.edges} nodeTypes=${nodeTypes}
            onNodesChange=${handleNodesChange}
            onNodeClick=${(_, n) => { setSelectedId(n.id); if (n.type === 'endpoint' && !['settings', 'body', 'log'].includes(tab)) setTab('settings'); }}
            onPaneClick=${() => setSelectedId(null)}
            onBeforeDelete=${onBeforeDelete}
            nodesConnectable=${false}
            colorMode="system" fitView fitViewOptions=${{ padding: 0.2 }} minZoom=${0.2}
            proOptions=${{ hideAttribution: true }}>
            <${Background} gap=${18} size=${1.2} />
            <${Controls} showInteractive=${false}>
              <${ControlButton} onClick=${autoLayout} title="Auto layout" aria-label="Auto layout">⤧<//>
            <//>
            <${MiniMap} pannable zoomable nodeStrokeWidth=${3} style=${{ width: 150, height: 100 }} nodeColor=${(n) => `var(--kind-${n.type})`} />
          <//>
        </section>

        <${Splitter} axis="x" value=${panelW} onChange=${setPanelW} min=${300} max=${760} label="Resize the side panel" />
        <aside className="side" aria-label="Details">
          <${Panel} state=${state} selected=${selected} tab=${tab} setTab=${setTab} firm=${firm} zapOut=${zapOut} onClose=${() => setSelectedId(null)} />
        </aside>

        <${Splitter} axis="y" value=${drawerH} onChange=${setDrawerH} min=${44} max=${600} label="Resize the activity drawer" />
        <section className="drawer" aria-label="Activity">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected=${drawerTab === 'deliveries'} className=${`tab ${drawerTab === 'deliveries' ? 'on' : ''}`} onClick=${() => setDrawerTab('deliveries')}>All deliveries (${firmDeliveries.length})</button>
            <button role="tab" aria-selected=${drawerTab === 'inbox'} className=${`tab ${drawerTab === 'inbox' ? 'on' : ''}`} onClick=${() => setDrawerTab('inbox')}>Receiver inbox (${state.received.length})</button>
          </div>
          <div className="drawer-body">
            ${drawerTab === 'deliveries'
              ? html`<${DeliveryList} rows=${firmDeliveries} showEndpoint endpoints=${endpointsById} />`
              : html`<${Inbox} rows=${state.received} />`}
          </div>
        </section>

        ${toast && html`<div className=${`toast ${toast.bad ? 'bad' : ''}`} role="status">${toast.message}</div>`}
      </div>
    <//>`;
}

createRoot(document.getElementById('root')).render(html`<${ReactFlowProvider}><${Canvas} /><//>`);
