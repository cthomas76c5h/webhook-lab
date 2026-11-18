// PROTOTYPE: the operator Delivery Center (mockup), live against the lab.

import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  api, clock, html, Journey, leadNo, mappingToTemplate, nextAction, problem, RECIPES, SOURCE_FIELDS, STATUS, templateToMapping, useSnapshot, useToast,
} from './common.js';

function Ops() {
  const state = useSnapshot();
  const { act, view: toast } = useToast();
  const [firm, setFirm] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [mapping, setMapping] = useState(null); // { endpoint, rows }
  const dialog = useRef(null);

  const data = useMemo(() => {
    if (!state) return null;
    const eps = new Map(state.endpoints.map((e) => [e.id, e]));
    const firms = new Map(state.firms.map((f) => [f.id, f]));
    // A failure later fixed by a Resend is resolved, not "needs attention".
    const accepted = new Set(state.deliveries.filter((d) => d.status === 'delivered').map((d) => `${d.eventId}|${d.endpointId}`));
    const rows = state.deliveries.map((d) => {
      const resolved = d.status === 'failed' && accepted.has(`${d.eventId}|${d.endpointId}`);
      return { ...d, resolved, ep: eps.get(d.endpointId), firm: firms.get(d.firmId) };
    });
    const today = rows.filter((d) => !d.test && Date.now() - d.createdAt < 86_400_000);
    const done = today.filter((d) => ['delivered', 'failed'].includes(d.status));
    return {
      rows,
      tiles: {
        active: state.endpoints.filter((e) => e.status === 'active').length,
        added: state.endpoints.filter((e) => Date.now() - e.createdAt < 7 * 86_400_000).length,
        accepted: today.filter((d) => d.status === 'delivered').length,
        rate: done.length ? Math.round((today.filter((d) => d.status === 'delivered').length / done.length) * 1000) / 10 : 100,
        attention: rows.filter((d) => d.status === 'failed' && !d.resolved).length + state.endpoints.filter((e) => e.status !== 'active').length,
        retrying: rows.filter((d) => d.status === 'pending').length,
      },
    };
  }, [state]);

  if (!state || !data) return html`<p className="boot">Loading…</p>`;

  const shown = data.rows.filter((d) =>
    (firm === 'all' || d.firmId === firm) &&
    (status === 'all' || (status === 'attention' ? d.status === 'failed' && !d.resolved : d.status === status)));
  const sel = data.rows.find((d) => d.id === selected) ?? null;

  const resend = (ids) => act(async () => { for (const id of ids) await api('POST', `/admin/deliveries/${id}/replay`); }, ids.length > 1 ? `Resent ${ids.length} leads` : 'Resent with the same webhook-id');
  const openMapping = (ep) => {
    setMapping({ endpoint: ep, rows: templateToMapping(ep.template) ?? [{ from: 'full_name', to: 'Name' }, { from: 'phone', to: 'Phone' }, { from: 'message', to: 'Notes' }] });
    requestAnimationFrame(() => dialog.current?.showModal());
  };
  const saveMapping = async () => {
    const ok = await act(() => api('PATCH', `/admin/endpoints/${mapping.endpoint.id}`, { template: mappingToTemplate(mapping.rows) }), 'Mapping saved');
    if (ok) dialog.current?.close();
  };
  const badge = (d) => {
    if (d.resolved) return html`<span className="badge muted">Resolved by resend</span>`;
    const s = STATUS[d.status];
    return html`<span className=${`badge ${s.tone}`}>${s.label}</span>`;
  };

  return html`
    <div className="shell">
      <header className="shell-top">
        <div className="brand"><span className="logo">◉</span> Answering AI <span className="sep"></span> <span className="muted">Operator Console</span></div>
        <span className="tag">prototype</span>
        <div className="spacer"></div>
        <nav className="views" aria-label="Lab views">
          <a href="/workshop.html">Workshop</a><a href="/">Canvas</a><a href="/portal.html">Firm portal</a><a href="/onboard.html">Onboarding</a><a href="/ops.html" aria-current="page">Delivery Center</a>
        </nav>
      </header>
      <aside className="shell-nav">
        ${['Overview', 'Delivery Center', 'Alerts', 'Firms', 'Recipes', 'Logs'].map((n) => html`
          <a key=${n} className=${`navlink ${n === 'Delivery Center' ? 'on' : ''}`} aria-current=${n === 'Delivery Center' ? 'page' : undefined}>
            ${n}${n === 'Alerts' && data.tiles.attention > 0 && html` <span className="count">${data.tiles.attention}</span>`}
          </a>`)}
      </aside>

      <main className="shell-main">
        <h1>Delivery Center</h1>
        <p className="muted">Every lead, every destination, every firm. Most deliveries need nothing; handle the exceptions here.</p>

        <div className="tiles">
          <div className="tile"><span className="tile-icon">⛓</span><span>Active connections</span><strong>${data.tiles.active}</strong><small className="ok">↑ ${data.tiles.added} this week</small></div>
          <div className="tile"><span className="tile-icon ok">✓</span><span>Accepted today</span><strong>${data.tiles.accepted}</strong><small className="ok">${data.tiles.rate}% accepted</small></div>
          <button className=${`tile ${data.tiles.attention ? 'alert' : ''}`} onClick=${() => setStatus('attention')}><span className="tile-icon bad">⚠</span><span>Needs attention</span><strong>${data.tiles.attention}</strong><small>Show them</small></button>
          <div className="tile"><span className="tile-icon">⟳</span><span>Retry queue</span><strong>${data.tiles.retrying}</strong><small className="muted">Retrying by itself</small></div>
        </div>

        <div className=${`ops-grid ${sel ? 'with-drawer' : ''}`}>
          <section className="card">
            <div className="card-head">
              <h2 className="grow">Delivery log</h2>
              ${checked.size > 0 && html`<button className="btn" onClick=${() => { resend([...checked]); setChecked(new Set()); }}>Resend ${checked.size}</button>`}
              <select value=${firm} onChange=${(e) => setFirm(e.target.value)} aria-label="Firm">
                <option value="all">All firms</option>
                ${state.firms.map((f) => html`<option key=${f.id} value=${f.id}>${f.name}</option>`)}
              </select>
              <select value=${status} onChange=${(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                <option value="attention">Needs attention</option>
                <option value="delivered">Accepted</option>
                <option value="pending">Retrying</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="table-wrap">
              <table className="log">
                <thead><tr><th><span className="visually-hidden">Select</span></th><th>Lead</th><th>Firm</th><th>Destination</th><th>Recipe</th><th>Status</th><th>Last try</th></tr></thead>
                <tbody>
                  ${shown.map((d) => html`
                    <tr key=${d.id} className=${d.id === selected ? 'on' : ''} onClick=${() => setSelected(d.id)}>
                      <td onClick=${(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label=${`Select ${leadNo(d.eventId)}`} checked=${checked.has(d.id)}
                          onChange=${(e) => { const n = new Set(checked); e.target.checked ? n.add(d.id) : n.delete(d.id); setChecked(n); }} />
                      </td>
                      <td><span className="mono">${leadNo(d.eventId)}</span>${d.test && html` <span className="chip">sample</span>`}</td>
                      <td className="ellipsis">${d.firm?.name ?? '—'}</td>
                      <td className="ellipsis">${d.ep?.name ?? '(removed)'}</td>
                      <td className="ellipsis">${RECIPES[d.ep?.recipe]?.label ?? '—'}</td>
                      <td>${badge(d)}</td>
                      <td className="muted">${d.attempts.length ? clock(d.attempts.at(-1).at) : '—'}</td>
                    </tr>`)}
                  ${shown.length === 0 && html`<tr><td colSpan="7" className="muted empty">Nothing here. Simulate a call on the Canvas.</td></tr>`}
                </tbody>
              </table>
            </div>
          </section>

          ${sel && html`
            <aside className="card drawer-card" aria-label=${`Lead ${leadNo(sel.eventId)}`}>
              <div className="card-head">
                <h2 className="grow">Lead ${leadNo(sel.eventId)}</h2>
                <button className="btn icon" aria-label="Close" onClick=${() => setSelected(null)}>✕</button>
              </div>
              <dl className="facts">
                <dt>Caller</dt><dd>${sel.lead}</dd>
                <dt>Firm</dt><dd>${sel.firm?.name ?? '—'}</dd>
                <dt>Destination</dt><dd>${sel.ep?.name ?? '(removed)'}</dd>
                <dt>Recipe</dt><dd>${RECIPES[sel.ep?.recipe]?.label ?? '—'}</dd>
                <dt>Status</dt><dd>${badge(sel)}</dd>
              </dl>
              <${Journey} d=${sel} />
              ${sel.status === 'failed' && !sel.resolved && html`
                <div className="errbox"><strong>⚠ ${problem(sel)}</strong><span>${nextAction(sel)}</span></div>`}
              <div className="stack">
                <button className="btn primary wide" disabled=${!sel.ep || sel.ep.status !== 'active' || !['failed', 'cancelled', 'delivered'].includes(sel.status)} onClick=${() => resend([sel.id])}>▷ Resend</button>
                <button className="btn wide" disabled=${!sel.ep} onClick=${() => openMapping(sel.ep)}>✎ Edit mapping</button>
                ${sel.ep && (sel.ep.status === 'active'
                  ? html`<button className="btn wide" onClick=${() => act(() => api('PATCH', `/admin/endpoints/${sel.ep.id}`, { status: 'disabled' }), 'Destination paused')}>❚❚ Pause destination</button>`
                  : html`<button className="btn wide" onClick=${() => act(() => api('PATCH', `/admin/endpoints/${sel.ep.id}`, { status: 'active' }), 'Destination on')}>▶ Turn destination on</button>`)}
              </div>
              <details className="raw">
                <summary>What was sent (${sel.attempts.length} ${sel.attempts.length === 1 ? 'try' : 'tries'})</summary>
                ${sel.attempts.map((a) => html`<pre key=${a.n} className="out">#${a.n} ${a.status ? `HTTP ${a.status}` : a.error} · ${a.outcome}${'\n\n'}${a.requestBody}</pre>`)}
              </details>
            </aside>`}
        </div>

        <section className="card how">
          <div className="card-head"><h2 className="grow">How it works</h2><span className="ok small">✓ Operate by exception: most deliveries flow by themselves.</span></div>
          <ol className="how-strip">
            <li><span>☎</span><strong>AI receptionist</strong><small>Answers and takes the intake</small></li>
            <li className="hub"><span>▣</span><strong>Standard lead event</strong><small>One format for every firm</small></li>
            <li><span>⚙</span><strong>Delivery engine</strong><small>Recipes, mappings, retries, log</small></li>
            <li><span>⇢</span><strong>Firm systems</strong><small>Zapier, webhooks, CRMs</small></li>
          </ol>
        </section>
      </main>

      <dialog ref=${dialog} closedby="any" aria-labelledby="map-title" className="map-dialog">
        ${mapping && html`
          <h2 id="map-title">Mapping — ${mapping.endpoint.name}</h2>
          <p className="muted small">The receiver gets one field per row. Resend after saving to retry with the new mapping.</p>
          <div className="maprows">
            ${mapping.rows.map((r, i) => html`
              <div key=${i} className="maprow">
                <select aria-label="Answering AI field" value=${r.from} onChange=${(e) => setMapping({ ...mapping, rows: mapping.rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })}>
                  ${Object.entries(SOURCE_FIELDS).map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}
                </select>
                <span aria-hidden="true">→</span>
                <input aria-label="Receiver field" value=${r.to} onChange=${(e) => setMapping({ ...mapping, rows: mapping.rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
                <button className="btn icon" aria-label="Remove row" onClick=${() => setMapping({ ...mapping, rows: mapping.rows.filter((_, j) => j !== i) })}>✕</button>
              </div>`)}
          </div>
          <div className="row end">
            <button className="btn" onClick=${() => setMapping({ ...mapping, rows: [...mapping.rows, { from: 'phone', to: 'Phone' }] })}>Add field</button>
            <span className="spacer"></span>
            <button className="btn" onClick=${() => dialog.current?.close()}>Cancel</button>
            <button className="btn primary" onClick=${saveMapping}>Save mapping</button>
          </div>`}
      </dialog>
      ${toast}
    </div>`;
}

createRoot(document.getElementById('root')).render(html`<${Ops} />`);
