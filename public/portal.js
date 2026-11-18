// PROTOTYPE: the firm's Integrations page (client portal mockup), live against the lab.

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  api, connectionStatus, html, Journey, mappingToTemplate, problem, RECIPES, SOURCE_FIELDS, store, templateToMapping, useSnapshot, useToast,
} from './common.js';

const STEPS = ['Choose destination', 'Connect', 'Choose recipe', 'Map fields', 'Send test'];

const DESTINATIONS = {
  zapier: { label: 'Automation tool', sub: 'Zapier — connects to Clio, MyCase, Lawmatics and 6,000+ apps', icon: '⚡' },
  webhook: { label: 'Webhook', sub: 'Send to your own system', icon: '⇢' },
  crm: { label: 'Legal CRM (direct)', sub: 'Clio Grow, Lawmatics, MyCase', icon: '⚖', planned: true },
};

const DEFAULT_ROWS = {
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

function Step({ n, title, sub, done, open, onToggle, children }) {
  return html`
    <section className=${`wstep ${open ? 'open' : ''}`}>
      <button className="wstep-head" onClick=${onToggle} aria-expanded=${open}>
        <span className=${`tick ${done ? 'done' : ''}`}>${done ? '✓' : n}</span>
        <span className="grow"><strong>${n}. ${title}</strong><small>${sub}</small></span>
        <span className="chev" aria-hidden="true">${open ? '▴' : '▾'}</span>
      </button>
      ${open && html`<div className="wstep-body">${children}</div>`}
    </section>`;
}

function Portal() {
  const state = useSnapshot();
  const { act, view: toast } = useToast();
  const [firmId, setFirmId] = useState(() => store.get('webhook-lab:firm'));
  const [kind, setKind] = useState('zapier');
  const [endpointId, setEndpointId] = useState(null);
  const [open, setOpen] = useState(1);
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState(DEFAULT_ROWS['create-intake']);
  const [testId, setTestId] = useState(null);

  useEffect(() => {
    if (state && !state.firms.some((f) => f.id === firmId)) setFirmId(state.firms[0]?.id ?? null);
  }, [state, firmId]);
  useEffect(() => store.set('webhook-lab:firm', firmId), [firmId]);

  const firm = state?.firms.find((f) => f.id === firmId);
  const endpoints = state ? state.endpoints.filter((e) => e.firmId === firmId) : [];
  const ep = endpoints.find((e) => e.id === endpointId) ?? null;
  const testDelivery = useMemo(
    () => (state && ep ? state.deliveries.find((d) => d.endpointId === ep.id && d.test) : null),
    [state, ep, testId],
  );

  if (!state || !firm) return html`<p className="boot">Loading…</p>`;

  const done = [
    true,
    !!ep,
    !!ep?.recipe,
    !!ep && (ep.source === 'rest-hook' || !!ep.template),
    testDelivery?.status === 'delivered',
  ];
  const status = ep ? connectionStatus(ep, state.deliveries) : null;
  const lastFailed = status?.tone === 'bad'
    ? state.deliveries.find((d) => d.endpointId === ep.id && !d.test && d.status === 'failed')
    : null;

  const edit = (e) => {
    setEndpointId(e.id);
    setKind(e.source === 'rest-hook' ? 'zapier' : 'webhook');
    setRows(templateToMapping(e.template) ?? DEFAULT_ROWS[e.recipe ?? 'create-intake']);
    setOpen(e.recipe ? 4 : 3);
  };
  const startNew = () => { setEndpointId(null); setOpen(1); setUrl(''); };

  const connectZapier = async () => {
    // What Zapier does when the firm turns its Zap on: subscribe with the firm's key.
    const r = await act(
      () => api('POST', '/v1/hooks', { target_url: `${state.config.origin}/receiver/ok`, event: 'lead.created' }, { 'x-api-key': firm.apiKey }),
      'Zapier connected',
    );
    if (r) { setEndpointId(r.id); setOpen(3); }
  };
  const connectWebhook = async () => {
    const r = await act(() => api('POST', '/admin/endpoints', { firmId, name: 'Webhook', url }), 'Webhook saved');
    if (r) { setEndpointId(r.id); setOpen(3); }
  };
  const chooseRecipe = async (recipe) => {
    if (!ep) return;
    await act(() => api('PATCH', `/admin/endpoints/${ep.id}`, { recipe, name: `${RECIPES[recipe].label} (${kind === 'zapier' ? 'Zapier' : 'Webhook'})` }));
    if (!ep.template) setRows(DEFAULT_ROWS[recipe]);
    setOpen(4);
  };
  const saveMapping = async () => {
    const ok = await act(() => api('PATCH', `/admin/endpoints/${ep.id}`, { template: mappingToTemplate(rows) }), 'Mapping saved');
    if (ok) setOpen(5);
  };
  const sendTest = async () => {
    const r = await act(() => api('POST', `/admin/endpoints/${ep.id}/test`, {}), 'Sample intake sent');
    if (r) setTestId(r.eventId);
  };

  return html`
    <div className="shell">
      <header className="shell-top">
        <div className="brand"><span className="logo">◉</span> Answering AI <span className="sep"></span> <span className="muted">Client Portal</span></div>
        <span className="tag">prototype</span>
        <div className="spacer"></div>
        <nav className="views" aria-label="Lab views">
          <a href="/workshop.html">Workshop</a><a href="/">Canvas</a><a href="/portal.html" aria-current="page">Firm portal</a><a href="/onboard.html">Onboarding</a><a href="/ops.html">Delivery Center</a>
        </nav>
      </header>
      <aside className="shell-nav">
        <label className="firm-switch">
          <span className="visually-hidden">Firm</span>
          <select value=${firmId} onChange=${(e) => { setFirmId(e.target.value); startNew(); }}>
            ${state.firms.map((f) => html`<option key=${f.id} value=${f.id}>${f.name}</option>`)}
          </select>
        </label>
        ${['Dashboard', 'Calls', 'Intakes', 'Integrations', 'Billing', 'Settings'].map((n) => html`
          <a key=${n} className=${`navlink ${n === 'Integrations' ? 'on' : ''}`} aria-current=${n === 'Integrations' ? 'page' : undefined}>${n}</a>`)}
      </aside>

      <main className="shell-main">
        <h1>Integrations</h1>
        <p className="muted">Send each new intake to your case management, automation or own system.</p>

        <div className="portal-grid">
          <div className="card">
            <div className="card-head">
              <span className="icon-box">⛓</span>
              <div className="grow">
                <h2>${ep ? ep.name : 'Connect your workflow'}</h2>
                <p className="muted small">Choose a destination, connect it, pick what should happen, and send a test. A few minutes.</p>
              </div>
              ${status && html`<span className=${`badge ${status.tone}`}>${status.label}</span>`}
            </div>
            ${lastFailed && html`<div className="errbox">
              <strong>⚠ Your system refused recent intakes: ${problem(lastFailed)}</strong>
              <span>${kind === 'zapier' ? 'Check the Zap in Zapier.' : 'Fix it in step 4, Map fields, then send a test.'} We keep retrying new intakes; Answering AI support can resend the ones that failed.</span>
            </div>`}

            <ol className="stepper">
              ${STEPS.map((s, i) => html`<li key=${s} className=${done[i] ? 'done' : open === i + 1 ? 'now' : ''}><span>${s}</span></li>`)}
            </ol>

            <${Step} n=${1} title="Choose destination" sub="Where should new intakes go?" done=${done[0] && open > 1} open=${open === 1} onToggle=${() => setOpen(1)}>
              <div className="choice-row">
                ${Object.entries(DESTINATIONS).map(([k, d]) => html`
                  <button key=${k} className=${`choice ${kind === k ? 'on' : ''}`} disabled=${d.planned || !!ep} aria-pressed=${kind === k}
                    onClick=${() => { setKind(k); setOpen(2); }}>
                    <span className="choice-icon">${d.icon}</span>
                    <strong>${d.label}</strong><small>${d.sub}</small>
                    ${d.planned && html`<span className="badge muted">Planned</span>`}
                  </button>`)}
              </div>
            <//>

            <${Step} n=${2} title="Connect" sub=${kind === 'zapier' ? 'Connect your Zapier account.' : 'Where should we send the intake?'} done=${done[1]} open=${open === 2} onToggle=${() => setOpen(2)}>
              ${kind === 'zapier'
                ? html`<div className="stack">
                    <p className="small">In Zapier, choose <strong>Answering AI → New Intake</strong> and paste this key when asked. Nothing to copy back to us.</p>
                    <div className="keybox"><code>${firm.apiKey}</code><button className="btn" onClick=${() => { void navigator.clipboard?.writeText(firm.apiKey); }}>Copy</button></div>
                    ${ep ? html`<p className="ok small">✓ Zapier is connected.</p>`
                      : html`<div className="row"><button className="btn primary" onClick=${connectZapier}>Open Zapier</button>
                        <span className="muted small">Lab: this plays the call Zapier makes when you turn your Zap on.</span></div>`}
                  </div>`
                : html`<form className="stack" onSubmit=${(e) => { e.preventDefault(); connectWebhook(); }}>
                    <label className="field">Address<input type="url" required value=${url} disabled=${!!ep} placeholder="https://…" onChange=${(e) => setUrl(e.target.value)} /></label>
                    <div className="row small muted">Lab receivers:
                      ${['ok', 'reject', 'flaky'].map((m) => html`<button key=${m} type="button" className="chip btn-chip" disabled=${!!ep} onClick=${() => setUrl(`${state.config.origin}/receiver/${m}`)}>${m}</button>`)}
                    </div>
                    ${!ep && html`<div className="row"><button className="btn primary" type="submit">Save address</button></div>`}
                  </form>`}
            <//>

            <${Step} n=${3} title="Choose recipe" sub="What should happen with each intake?" done=${done[2]} open=${open === 3} onToggle=${() => ep && setOpen(3)}>
              <div className="choice-row">
                ${Object.entries(RECIPES).map(([k, r]) => html`
                  <button key=${k} className=${`choice radio ${ep?.recipe === k ? 'on' : ''}`} aria-pressed=${ep?.recipe === k} disabled=${!ep} onClick=${() => chooseRecipe(k)}>
                    <strong>${r.label}</strong><small>${r.help}</small>
                  </button>`)}
              </div>
            <//>

            <${Step} n=${4} title="Map fields" sub=${kind === 'zapier' ? 'You map fields in Zapier.' : 'Match our fields to yours.'} done=${done[3]} open=${open === 4} onToggle=${() => ep && setOpen(4)}>
              ${kind === 'zapier'
                ? html`<div className="stack small">
                    <p>Zapier shows every field with a clear label. Typical matches:</p>
                    <div className="maprows readonly">
                      ${DEFAULT_ROWS[ep?.recipe ?? 'create-intake'].map((r) => html`<div key=${r.from} className="maprow"><span className="pill">${SOURCE_FIELDS[r.from]}</span><span>→</span><span className="pill out">${r.to}</span></div>`)}
                    </div>
                    <div className="row"><button className="btn primary" onClick=${() => setOpen(5)}>Continue</button></div>
                  </div>`
                : html`<div className="stack">
                    <div className="maprows">
                      ${rows.map((r, i) => html`
                        <div key=${i} className="maprow">
                          <select aria-label="Answering AI field" value=${r.from} onChange=${(e) => setRows(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}>
                            ${Object.entries(SOURCE_FIELDS).map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}
                          </select>
                          <span aria-hidden="true">→</span>
                          <input aria-label="Your field" value=${r.to} onChange=${(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                          <button className="btn icon" aria-label="Remove row" onClick=${() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                        </div>`)}
                    </div>
                    <div className="row">
                      <button className="btn" onClick=${() => setRows([...rows, { from: 'details', to: '' }])}>Add field</button>
                      <button className="btn primary" onClick=${saveMapping}>Save mapping</button>
                    </div>
                  </div>`}
            <//>

            <${Step} n=${5} title="Send test intake" sub="A sample intake, so you can confirm it arrives." done=${done[4]} open=${open === 5} onToggle=${() => ep && setOpen(5)}>
              <div className="stack">
                <div className="row">
                  <button className="btn primary" disabled=${!ep || ep.status !== 'active'} onClick=${sendTest}>Send test intake</button>
                  ${testDelivery?.status === 'delivered' && html`<span className="badge ok">✓ Sample accepted</span>`}
                  ${status && html`<span className=${`badge ${status.tone}`}>${status.label}</span>`}
                </div>
                ${testDelivery && html`<${Journey} d=${testDelivery} />`}
                ${testDelivery?.status === 'failed' && html`<p className="bad small">Your system refused the sample. Check the mapping in step 4, then send it again.</p>`}
                ${testDelivery?.status === 'delivered' && html`<p className="muted small">${kind === 'zapier' ? 'Zapier' : 'Your system'} accepted the sample. We cannot see your CRM, so check that it arrived there.</p>`}
              </div>
            <//>
          </div>

          <aside className="card side-list">
            <h2>Your connections</h2>
            <p className="muted small">Each one runs automatically on every intake.</p>
            ${endpoints.map((e) => {
              const s = connectionStatus(e, state.deliveries);
              return html`
                <button key=${e.id} className=${`conn ${e.id === endpointId ? 'on' : ''}`} onClick=${() => edit(e)}>
                  <span className="conn-icon">${e.source === 'rest-hook' ? '⚡' : '⇢'}</span>
                  <span className="grow"><strong>${e.name}</strong><small>${RECIPES[e.recipe]?.label ?? 'No recipe yet'}</small></span>
                  <span className=${`badge ${s.tone}`}>${s.label}</span>
                </button>`;
            })}
            <button className="btn wide" onClick=${startNew}>+ Add a connection</button>
            <div className="note">ⓘ Set up once. It runs on every intake after that.</div>
          </aside>
        </div>
      </main>
      ${toast}
    </div>`;
}

createRoot(document.getElementById('root')).render(html`<${Portal} />`);
