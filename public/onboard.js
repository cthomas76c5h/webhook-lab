// PROTOTYPE: operator onboarding cockpit. The operator configures; the client
// connects and approves through a secure link; the system tests and delivers.

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ago, api, html, Journey, problem, RECIPES, SOURCE_FIELDS, useSnapshot, useToast } from './common.js';

const DESTINATIONS = {
  'zapier-catch': 'Zapier (Catch Hook, today)',
  'zapier-app': 'Zapier (Answering AI app, V2)',
  webhook: 'Webhook (their own system)',
};

function Check({ n, title, done, active, children }) {
  return html`
    <li className=${`check ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
      <span className=${`tick ${done ? 'done' : ''}`}>${done ? '✓' : n}</span>
      <div className="grow"><strong>${title}</strong>${children && html`<div className="check-body">${children}</div>`}</div>
    </li>`;
}

function MappingEditor({ setup, act }) {
  const [rows, setRows] = useState(setup.rows);
  useEffect(() => setRows(setup.rows), [setup.id, setup.version]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(setup.rows);
  return html`
    <div className="stack">
      ${!setup.enforced && html`<p className="small note">Plan only: with Zapier, these are set in the Zap with the client. We show them for review; we cannot enforce or verify them.</p>`}
      <div className="maprows">
        ${rows.map((r, i) => html`
          <div key=${i} className="maprow">
            <select aria-label="Answering AI field" value=${r.from} onChange=${(e) => setRows(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}>
              ${Object.entries(SOURCE_FIELDS).map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}
            </select>
            <span aria-hidden="true">→</span>
            <input aria-label=${`${setup.crm} field`} value=${r.to} onChange=${(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <button className="btn icon" aria-label="Remove row" onClick=${() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </div>`)}
      </div>
      <div className="row">
        <button className="btn" onClick=${() => setRows([...rows, { from: 'phone', to: 'Phone' }])}>Add field</button>
        <button className="btn primary" disabled=${!dirty} onClick=${() => act(() => api('PATCH', `/admin/setups/${setup.id}`, { rows }), 'Mapping saved as a new version')}>Save mapping</button>
        ${dirty && html`<span className="small warn">Saving makes a new version; the client must approve it again.${setup.live ? ` Live leads keep version ${setup.activeVersion} until you activate the new one.` : ''}</span>`}
      </div>
    </div>`;
}

function SetupRecord({ setup, state, act }) {
  const link = `${location.origin}/review.html?t=${setup.token}`;
  const test = setup.testDeliveryId ? state.deliveries.find((d) => d.id === setup.testDeliveryId) : null;
  const approved = setup.approvals.find((a) => a.version === setup.version && a.decision === 'approved');
  const changes = setup.approvals.find((a) => a.version === setup.version && a.decision === 'changes');
  const st = setup.state;
  const onActive = st === 'Live'; // live and no draft revision ahead of it
  const idx = (s) => ['Connection needed', 'Draft', 'Awaiting client approval', 'Changes requested', 'Ready to test', 'Testing', 'Test failed', 'Test accepted', 'Ready to go live', 'Live'].indexOf(s);

  return html`
    <section className="card record" aria-label=${`Setup for ${setup.firmName}`}>
      <div className="card-head">
        <div className="grow">
          <h2>${setup.firmName}</h2>
          <p className="muted small">${setup.crm} · ${DESTINATIONS[setup.destination]} · ${RECIPES[setup.recipe]?.label} · version ${setup.version}${setup.revising ? ` (draft) · live on version ${setup.activeVersion}` : ''}</p>
        </div>
        <span className=${`badge ${setup.tone}`}>${st}</span>
      </div>

      <div className="linkbox">
        <span className="small"><strong>Client link</strong> (connect, review, approve)</span>
        <code className="ellipsis">${link}</code>
        <button className="btn" onClick=${() => { void navigator.clipboard?.writeText(link); act(async () => {}, 'Link copied'); }}>Copy</button>
        <a className="btn" href=${link} target="client-view">Open as client</a>
      </div>

      <ol className="checklist">
        <${Check} n=${1} title=${setup.live ? 'Draft a revision' : 'Draft the configuration'} done=${true} active=${st === 'Draft' || st === 'Changes requested'}>
          ${onActive && html`<p className="small muted">Changing the recipe or mapping makes a draft revision. Live leads keep version ${setup.activeVersion} until the revision is approved, tested and activated.</p>`}
          <div className="row">
            <label className="field small">Recipe
              <select value=${setup.recipe} onChange=${(e) => act(() => api('PATCH', `/admin/setups/${setup.id}`, { recipe: e.target.value }), 'Recipe changed')}>
                ${Object.entries(RECIPES).map(([k, r]) => html`<option key=${k} value=${k}>${r.label}</option>`)}
              </select>
            </label>
          </div>
          <${MappingEditor} setup=${setup} act=${act} />
        <//>
        <${Check} n=${2} title="Client connects" done=${st !== 'Connection needed'} active=${st === 'Connection needed'}>
          ${st === 'Connection needed'
            ? html`<p className="small">Send the client link. They ${setup.destination === 'zapier-app' ? 'connect the Answering AI Zapier app' : 'paste the hook address'} themselves; nothing is read out or emailed.</p>`
            : html`<p className="small ok">Connected.</p>`}
        <//>
        <${Check} n=${3} title="Client approves" done=${!!approved} active=${['Draft', 'Awaiting client approval', 'Changes requested'].includes(st)}>
          ${changes && html`<div className="errbox"><strong>Changes requested by ${changes.by}</strong><span>${changes.comment}</span></div>`}
          ${approved && html`<p className="small ok">Approved by ${approved.by}, version ${approved.version}, ${ago(approved.at)}.</p>`}
          ${!approved && st !== 'Connection needed' && html`
            <div className="row">
              <button className="btn primary" disabled=${setup.sentVersion === setup.version && !changes} onClick=${() => act(() => api('POST', `/admin/setups/${setup.id}/send`), 'Sent for approval')}>
                ${setup.sentVersion === setup.version && !changes ? `Version ${setup.version} sent` : `Send version ${setup.version} for approval`}
              </button>
            </div>`}
        <//>
        <${Check} n=${4} title="Test with a real delivery" done=${test?.status === 'delivered' && !!setup.clientConfirmedAt} active=${idx(st) >= idx('Ready to test') && !onActive}>
          ${approved && !onActive && html`<div className="row"><button className="btn" onClick=${() => act(() => api('POST', `/admin/setups/${setup.id}/test`), 'Test lead sent')}>${test ? 'Send another test' : 'Send test lead'}</button></div>`}
          ${test && html`<${Journey} d=${test} />`}
          ${test?.status === 'failed' && html`<div className="errbox"><strong>⚠ ${problem(test)}</strong><span>${setup.enforced ? 'Fix the mapping in step 1 (it makes a new version for the client to approve), then test again.' : 'Check the Zap with the client, then test again.'}</span></div>`}
          ${test?.status === 'delivered' && !setup.clientConfirmedAt && html`
            <div className="row">
              <span className="small">Accepted by ${setup.enforced ? 'their system' : 'Zapier'}. Ask the client to look for the record in ${setup.crm}.</span>
              <button className="btn primary" onClick=${() => act(() => api('POST', `/admin/setups/${setup.id}/confirm`), 'Confirmation recorded')}>Client sees it in ${setup.crm}</button>
            </div>`}
          ${setup.clientConfirmedAt && html`<p className="small ok">Client confirmed the record in ${setup.crm}.</p>`}
        <//>
        <${Check} n=${5} title=${setup.live ? 'Activate' : 'Go live'} done=${onActive} active=${st === 'Ready to go live'}>
          ${onActive
            ? html`<p className="small ok">Live on version ${setup.activeVersion}. Real leads now go here; watch the Delivery Center.</p>`
            : setup.live
              ? html`<button className="btn primary" disabled=${st !== 'Ready to go live'} onClick=${() => act(() => api('POST', `/admin/setups/${setup.id}/go-live`), `Version ${setup.version} is live`)}>Activate version ${setup.version}</button>
                  <p className="muted small">Until then real leads keep using version ${setup.activeVersion}.</p>`
              : html`<button className="btn primary" disabled=${st !== 'Ready to go live'} onClick=${() => act(() => api('POST', `/admin/setups/${setup.id}/go-live`), `${setup.firmName} is live`)}>Confirm go-live</button>
                  <p className="muted small">Until then only test leads reach this destination.</p>`}
        <//>
      </ol>

      <details className="history" open>
        <summary>History</summary>
        <ol>
          ${setup.history.map((h, i) => html`<li key=${i}><span className=${`who who-${h.who}`}>${h.who}</span> ${h.what} <span className="muted small">${ago(h.at)}</span></li>`)}
        </ol>
      </details>
    </section>`;
}

function NewOnboarding({ state, act, onCreated }) {
  const [firmId, setFirmId] = useState(state.firms[0]?.id ?? '');
  const [destination, setDestination] = useState('zapier-catch');
  const [crm, setCrm] = useState('Clio Grow');
  const [recipe, setRecipe] = useState('create-intake');
  const [cloneFrom, setCloneFrom] = useState('');
  const sources = state.setups.filter((s) => s.live || s.state === 'Ready to go live');
  return html`
    <div className="card">
      <div className="card-head"><h2 className="grow">New onboarding</h2></div>
      <div className="form-grid">
        <label className="field">Firm<select value=${firmId} onChange=${(e) => setFirmId(e.target.value)}>${state.firms.map((f) => html`<option key=${f.id} value=${f.id}>${f.name}</option>`)}</select></label>
        <label className="field">CRM<input value=${crm} onChange=${(e) => setCrm(e.target.value)} list="crms" /></label>
        <datalist id="crms"><option>Clio Grow</option><option>Lawmatics</option><option>MyCase</option><option>Filevine</option></datalist>
        <label className="field">Connect through<select value=${destination} onChange=${(e) => setDestination(e.target.value)}>${Object.entries(DESTINATIONS).map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}</select></label>
        <label className="field">Recipe<select value=${recipe} onChange=${(e) => setRecipe(e.target.value)}>${Object.entries(RECIPES).map(([k, r]) => html`<option key=${k} value=${k}>${r.label}</option>`)}</select></label>
        <label className="field">Start the mapping from
          <select value=${cloneFrom} onChange=${(e) => setCloneFrom(e.target.value)}>
            <option value="">The recipe's defaults</option>
            ${sources.map((s) => html`<option key=${s.id} value=${s.id}>Copy ${s.firmName} (${s.crm}, known good)</option>`)}
          </select>
        </label>
      </div>
      <div className="row end">
        <button className="btn primary" onClick=${async () => { const r = await act(() => api('POST', '/admin/setups', { firmId, destination, crm, recipe, cloneFrom: cloneFrom || undefined }), 'Draft created'); if (r) onCreated(r.id); }}>Create draft</button>
      </div>
    </div>`;
}

function Cockpit() {
  const state = useSnapshot();
  const { act, view: toast } = useToast();
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('setup'));
  const [creating, setCreating] = useState(false);
  const order = ['Changes requested', 'Test failed', 'Ready to go live', 'Test accepted', 'Ready to test', 'Connection needed', 'Draft', 'Awaiting client approval', 'Testing', 'Live'];
  const queue = useMemo(() => (state?.setups ?? []).slice().sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)), [state]);
  if (!state) return html`<p className="boot">Loading…</p>`;
  const sel = state.setups.find((s) => s.id === selected) ?? null;
  const counts = { open: queue.filter((s) => s.state !== 'Live').length, mine: queue.filter((s) => ['Changes requested', 'Test failed', 'Ready to go live', 'Test accepted', 'Ready to test', 'Draft'].includes(s.state)).length, live: queue.filter((s) => s.live).length };

  return html`
    <div className="shell">
      <header className="shell-top">
        <div className="brand"><span className="logo">◉</span> Answering AI <span className="sep"></span> <span className="muted">Operator Console</span></div>
        <span className="tag">prototype</span>
        <div className="spacer"></div>
        <nav className="views" aria-label="Lab views">
          <a href="/workshop.html">Workshop</a><a href="/onboard.html" aria-current="page">Onboarding</a><a href="/ops.html">Delivery Center</a><a href="/">Canvas</a>
        </nav>
      </header>
      <aside className="shell-nav">
        ${['Overview', 'Onboarding', 'Delivery Center', 'Firms', 'Recipes'].map((n) => html`<a key=${n} className=${`navlink ${n === 'Onboarding' ? 'on' : ''}`}>${n}</a>`)}
      </aside>
      <main className="shell-main">
        <div className="row between">
          <div><h1>Onboarding</h1><p className="muted">You run the setup with the firm on a call. The firm connects and approves; the system tests and delivers.</p></div>
          <button className="btn primary" onClick=${() => setCreating(!creating)}>${creating ? 'Close' : '+ New onboarding'}</button>
        </div>
        <div className="tiles">
          <div className="tile"><span>Open onboardings</span><strong>${counts.open}</strong></div>
          <div className="tile"><span>Waiting on you</span><strong>${counts.mine}</strong></div>
          <div className="tile"><span>Live</span><strong>${counts.live}</strong></div>
        </div>
        ${creating && html`<${NewOnboarding} state=${state} act=${act} onCreated=${(id) => { setSelected(id); setCreating(false); }} />`}
        <div className=${`ops-grid ${sel ? 'with-record' : ''}`}>
          <section className="card">
            <div className="table-wrap">
              <table className="log queue">
                <thead><tr><th>Firm</th><th>CRM</th><th>Setup state</th><th>Next action</th></tr></thead>
                <tbody>
                  ${queue.map((s) => html`
                    <tr key=${s.id} className=${s.id === selected ? 'on' : ''} onClick=${() => setSelected(s.id)}>
                      <td className="ellipsis"><strong>${s.firmName}</strong></td>
                      <td>${s.crm}</td>
                      <td><span className=${`badge ${s.tone}`}>${s.state}</span>${s.revising && html` <span className="muted small">(live on v${s.activeVersion})</span>`}</td>
                      <td className="muted">${s.next}</td>
                    </tr>`)}
                </tbody>
              </table>
            </div>
          </section>
          ${sel && html`<${SetupRecord} setup=${sel} state=${state} act=${act} />`}
        </div>
      </main>
      ${toast}
    </div>`;
}

createRoot(document.getElementById('root')).render(html`<${Cockpit} />`);
