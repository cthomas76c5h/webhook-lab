// PROTOTYPE: the client's secure-link page. Connect, review what will be
// shared, approve or ask for changes. Sees only its own setup.

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ago, api, html, RECIPES, SOURCE_FIELDS, useToast } from './common.js';

const token = new URLSearchParams(location.search).get('t') ?? '';

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
            <p className="muted">${s.firmName} · ${s.live ? 'Live' : `Proposed setup, version ${s.version}`}</p>
          </div>
          <span className=${`badge ${s.live ? 'ok' : mine?.decision === 'approved' ? 'ok' : mine ? 'bad' : 'muted'}`}>
            ${s.live ? 'Live' : mine?.decision === 'approved' ? 'Approved' : mine ? 'Changes requested' : s.connected ? 'Awaiting your approval' : 'Connect first'}
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

        <section className="step-box">
          <h2>${s.connected ? '' : '2. '}Review what happens</h2>
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

        ${!s.live && s.connected && html`
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
