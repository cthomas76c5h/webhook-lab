// PROTOTYPE: the client's secure-link page. Connect, review what will be
// shared, approve or ask for changes. Sees only its own setup.

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ago, api, html, RECIPES, SOURCE_FIELDS, useToast } from './common.js';

const token = new URLSearchParams(location.search).get('t') ?? '';

const shared = (rows) => rows.map((r) => `${SOURCE_FIELDS[r.from] ?? r.from} → ${r.to}`);

/** Live setup vs the proposed revision, in business terms (no payloads). */
function ChangeSummary({ s }) {
  const was = s.active;
  const before = shared(was.rows);
  const after = shared(s.rows);
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  const cell = (a, b) => (a === b ? html`<td className="muted">Unchanged</td>` : html`<td><strong>${b}</strong></td>`);
  return html`
    <section className="step-box">
      <h2>What would change</h2>
      <table className="share">
        <thead><tr><th>Setting</th><th>Current (live, version ${was.version})</th><th>Proposed (version ${s.version})</th></tr></thead>
        <tbody>
          <tr><td>Destination</td><td>${was.crm}</td>${cell(was.crm, s.crm)}</tr>
          <tr><td>Action</td><td>${RECIPES[was.recipe]?.label ?? was.recipe}</td>${cell(RECIPES[was.recipe]?.label ?? was.recipe, RECIPES[s.recipe]?.label ?? s.recipe)}</tr>
          <tr><td>Information shared</td><td>${before.length} fields</td>
            ${added.length || removed.length
              ? html`<td>${added.map((x) => html`<div key=${'a' + x} className="ok">+ ${x}</div>`)}${removed.map((x) => html`<div key=${'r' + x} className="bad">− ${x}</div>`)}</td>`
              : html`<td className="muted">Unchanged</td>`}</tr>
        </tbody>
      </table>
      <p className="muted small">Your current setup keeps running until you approve this change and it is tested.</p>
    </section>`;
}

function Review() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [by, setBy] = useState('');
  const [comment, setComment] = useState('');
  const { act, view: toast } = useToast();

  const load = () => api('GET', `/client/setups/${token}`).then((x) => { setS(x); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, []);

  if (error) return html`<main className="client"><div className="card"><h1>This link does not work</h1><p className="muted">${error}. Ask your Answering AI contact for a new link.</p></div></main>`;
  if (!s) return html`<p className="boot">Loading…</p>`;

  const mine = s.approvals.find((a) => a.version === s.version);
  const onActive = s.live && !s.revising; // nothing awaiting the client's decision
  const decide = async (decision) => {
    const ok = await act(() => api('POST', `/client/setups/${token}/decision`, { decision, by, comment, version: s.version }), decision === 'approved' ? 'Thank you: setup approved' : 'Sent to your Answering AI contact');
    if (ok) { setComment(''); load(); }
  };

  return html`
    <main className="client">
      <header className="client-head">
        <div className="brand"><span className="logo">◉</span> Answering AI</div>
        <span className="tag">prototype</span>
      </header>

      <div className="card">
        <div className="card-head">
          <div className="grow">
            <h1>${RECIPES[s.recipe]?.label ?? 'New intakes'} → ${s.crm}</h1>
            <p className="muted">${s.firmName} · ${onActive ? 'Live' : s.revising ? `Live on version ${s.activeVersion} · proposed change, version ${s.version}` : `Proposed setup, version ${s.version}`}</p>
          </div>
          <span className=${`badge ${onActive ? 'ok' : mine?.decision === 'approved' ? 'ok' : mine ? 'bad' : 'muted'}`}>
            ${onActive ? 'Live' : mine?.decision === 'approved' ? 'Approved' : mine ? 'Changes requested' : s.connected ? 'Awaiting your approval' : 'Connect first'}
          </span>
        </div>

        ${!s.connected && html`
          <section className="step-box">
            <h2>1. Connect ${s.destination === 'webhook' ? 'your system' : 'Zapier'}</h2>
            ${s.destination === 'zapier-app'
              ? html`<p>In Zapier, add the <strong>Answering AI → New Intake</strong> trigger and sign in. Your contact will see the connection at once.</p>
                  <button className="btn primary" onClick=${() => act(() => api('POST', `/client/setups/${token}/connect`, {}), 'Connected').then(load)}>Connect with Zapier</button>
                  <p className="muted small">Lab: this plays the call the Zapier app makes.</p>`
              : html`<p>${s.destination === 'webhook' ? 'Paste the address your system receives intakes on.' : 'In your Zap, copy the Catch Hook address and paste it here. No need to email it.'}</p>
                  <form className="row" onSubmit=${(e) => { e.preventDefault(); act(() => api('POST', `/client/setups/${token}/connect`, { url }), 'Connected').then(load); }}>
                    <input type="url" required className="grow" placeholder="https://hooks.zapier.com/hooks/catch/…" value=${url} onChange=${(e) => setUrl(e.target.value)} aria-label="Address" />
                    <button className="btn primary" type="submit">Connect</button>
                  </form>
                  <p className="muted small">Lab: use ${location.origin}/receiver/ok</p>`}
          </section>`}

        ${s.revising && html`<${ChangeSummary} s=${s} />`}

        <section className="step-box">
          <h2>${s.connected ? '' : '2. '}Review what happens${s.revising ? ' after the change' : ''}</h2>
          <dl className="facts wide-facts">
            <dt>Destination</dt><dd>${s.crm} ${s.destination !== 'webhook' ? html`<span className="muted">(through Zapier)</span>` : ''}</dd>
            <dt>When</dt><dd>After each qualified call</dd>
            <dt>Action</dt><dd>${RECIPES[s.recipe]?.label} — ${RECIPES[s.recipe]?.help}</dd>
          </dl>
          <h3>What information is shared</h3>
          <table className="share">
            <thead><tr><th>From the call</th><th>Goes into ${s.crm}</th><th>Example</th></tr></thead>
            <tbody>${s.sample.map((r, i) => html`<tr key=${i}><td>${SOURCE_FIELDS[r.from] ?? r.from}</td><td><strong>${r.to}</strong></td><td className="muted ellipsis">${r.value}</td></tr>`)}</tbody>
          </table>
          ${!s.enforced && html`<p className="muted small">Your Answering AI contact sets these fields up in Zapier with you. We confirm Zapier receives each intake; please check the first ones arrive in ${s.crm}.</p>`}
        </section>

        ${!onActive && s.connected && html`
          <section className="step-box">
            <h2>${s.connected ? '' : '3. '}Approve or ask for changes</h2>
            ${mine && html`<p className=${mine.decision === 'approved' ? 'ok' : 'bad'}>${mine.decision === 'approved' ? `Approved by ${mine.by} ${ago(mine.at)}.` : `You asked: “${mine.comment}”. Your contact will update the setup.`}</p>`}
            ${!mine && html`
              <div className="stack">
                <label className="field">Your name<input value=${by} onChange=${(e) => setBy(e.target.value)} autoComplete="name" /></label>
                <label className="field">Comment (needed to ask for changes)<textarea className="note-input" value=${comment} onChange=${(e) => setComment(e.target.value)}></textarea></label>
                <div className="row">
                  <button className="btn" onClick=${() => decide('changes')}>Request changes</button>
                  <button className="btn primary" onClick=${() => decide('approved')}>Approve setup</button>
                </div>
                <p className="muted small">Your approval is recorded for version ${s.version}. Any later change needs your approval again.</p>
              </div>`}
          </section>`}

        ${s.approvals.length > 0 && html`
          <details className="history">
            <summary>Approval history</summary>
            <ol>${s.approvals.map((a, i) => html`<li key=${i}>Version ${a.version}: ${a.decision === 'approved' ? 'approved' : 'changes requested'} by ${a.by}${a.comment ? ` — “${a.comment}”` : ''} <span className="muted small">${ago(a.at)}</span></li>`)}</ol>
          </details>`}
      </div>
      ${toast}
    </main>`;
}

createRoot(document.getElementById('root')).render(html`<${Review} />`);
