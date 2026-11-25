// PROTOTYPE: facilitator page for the "From Webhooks to Self-Service Integrations"
// workshop. Each agenda block pairs the room's questions with a live lab
// situation, the evidence it shows, and a prepared answer kept closed until the
// room has spoken. Notes save to workshop-notes.json and export as Markdown.

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, html, useToast } from './common.js';

// ---------- content ----------

const DEMOS = {
  'assisted-onboarding': 'Operator-assisted onboarding (MVP)',
  'normal-delivery': 'Normal delivery',
  'zapier-self-setup': 'Firm connects Zapier itself (V2)',
  'crm-rejects': 'CRM rejects a record',
  'deleted-zap': 'Firm deletes its Zap',
  'receiver-down': 'Zapier outage, retries',
  duplicate: 'Resend creates a duplicate risk',
  'revoke-key': 'Staff member leaves (key revoked)',
  'change-crm': 'Firm changes CRM (parallel run)',
};

const SECTIONS = [
  {
    id: 'frame', time: [0, 10], title: 'Frame the problem', slides: 'Slide 1',
    intro: 'We are deciding a platform capability, not approving a Zapier feature.',
    asks: [
      { id: 'frame-problem', q: 'What business problem would make this worth funding: Zapier onboarding, delivery reliability, or connecting firms to their software in general?',
        a: 'All three, in that order of urgency: reliability protects firms we already have, self-setup removes the operator from onboarding, and the general case is the direction. Fund the first two now.' },
      { id: 'frame-zero-touch', q: 'Is the goal zero-touch onboarding, or onboarding that succeeds the first time without an engineer?',
        a: 'The second. A knowledgeable operator on the call is a feature for law firms. Remove the technical work and the back-and-forth, not the operator: the operator configures, the client connects and approves, the system tests and delivers.' },
      { id: 'frame-scale', q: 'Are we optimizing for the next 50 firms, or building for 2,000?',
        a: 'Build the foundation for 2,000 (one delivery pipeline, scoped keys, subscriptions); ship only what the next 50 need (V2 Zapier self-setup). No integration engine before a second destination type exists.' },
    ],
    demos: ['normal-delivery'],
    evidence: 'Canvas: one call becomes one standard lead that fans out to each destination. Nothing in the call path knows which CRM a firm uses.',
  },
  {
    id: 'reality', time: [10, 25], title: 'Walk through reality', slides: 'Slides 2–3 · Exercise A',
    intro: 'Reconstruct one real firm onboarding, a normal delivery and a failure. Mark every handoff.',
    asks: [
      { id: 'reality-delays', q: 'Which of the seven V1 steps actually cause delays, errors or tickets?',
        a: 'The URL handoff (copy, email, paste), "keep the Zap open" during our test, Zapier choosing a real call with empty fields as the sample, and the silent failure after a Zap is deleted.' },
      { id: 'reality-operators', q: 'Operators in the room: walk us through your last onboarding. Which spreadsheets, emails, chat messages and Zapier screens did you use?',
        a: 'These are the real requirements. Every side channel (an emailed URL, a screenshot of a Zap, a spreadsheet of firms) is something the onboarding cockpit should replace with a field, a link or a status.' },
      { id: 'reality-owner', q: 'Who owns setup, testing, monitoring and recovery today?',
        a: 'Setup and testing are shared between firm and operator, which means nobody fully owns them. Monitoring is a Slack alert to staff. Recovery needs the firm to send a new URL.' },
    ],
    demos: ['normal-delivery', 'deleted-zap', 'assisted-onboarding'],
    evidence: 'Delivery Center: a deleted Zap answers 410; the destination switches off once with the reason. Onboarding: the same handoffs as one queue, a secure link in place of the emailed URL, and a recorded approval.',
    exercise: 'A',
  },
  {
    id: 'requirements', time: [25, 45], title: 'Gather requirements', slides: 'Slides 7–8 · Exercise B',
    intro: 'Walk through six situations. For each: outcome, actor, expected and failure behavior, priority, evidence. Run it in the lab while the room answers.',
    asks: [
      { id: 'req-auto', q: 'Which failures can we recover from automatically, and when does a human step in?',
        a: 'Automatic: no answer, timeouts, 429 and 5xx (retries for about 21 hours, honouring Retry-After). Human: 410 deleted Zap (firm reconnects), 4xx refusals (fix mapping, then resend), revoked key (firm reconnects). Duplicates: the receiver dedupes on webhook-id.' },
    ],
    demos: ['receiver-down', 'deleted-zap', 'crm-rejects', 'revoke-key', 'duplicate'],
    evidence: 'Each failure shows its journey (published → sent → accepted → CRM unknown) and a next action. "In the CRM" is never claimed.',
    exercise: 'B',
  },
  {
    id: 'options', time: [45, 60], title: 'Evaluate solution levels', slides: 'Slides 4–6',
    intro: 'V1 Catch Hook handoff · V2 our own Zapier trigger · V3 in-portal CRM marketplace. Different scope; be explicit which one is funded.',
    asks: [
      { id: 'options-level', q: 'Which level are we funding, and why?',
        a: 'V2 now: it removes every operator handoff with modest engineering (keys, subscriptions, a small Zapier app). V3 is the direction; it needs direct CRM connectors or an embedded platform, so decide it after the pilot.' },
      { id: 'options-approve', q: 'Which decisions should clients approve or change themselves, and which stay with the operator?',
        a: 'Client: connecting (credentials never pass through an operator), what is shared and where, and the final approval of each version. Operator: recipe, mapping, testing, go-live. Any change after approval needs a new approval.' },
      { id: 'options-experience', q: 'Is the portal mockup the experience we want firms to associate with Answering AI?',
        a: 'Yes as direction, with honesty: in V2 the firm still maps fields in Zapier, and we can only claim "accepted by Zapier". The lab portal shows both limits.' },
    ],
    demos: ['assisted-onboarding', 'zapier-self-setup'],
    evidence: 'Onboarding: the operator drafts, the client connects and approves on the review page (Open as client), the operator tests and goes live. Firm portal: the self-service path for later. "Legal CRM (direct)" is V3.',
    table: {
      head: ['', 'V1 Catch Hook', 'V2 Native Zapier', 'V3 Marketplace'],
      rows: [
        ['Firm sends URL to operator', 'Required', 'No', 'No'],
        ['Firm configures Zapier', 'Yes', 'Yes', 'Only for Zapier workflows'],
        ['Sample data for mapping', 'A real call, maybe empty', 'Complete sample, any time', 'Our own mapping UI'],
        ['Deleted Zap', 'Silent repeated failures', 'Unsubscribe removes it', 'Connection status'],
        ['CRM-side errors visible to us', 'No', 'No', 'Where the CRM API allows'],
        ['Engineering per new firm', 'Low, variable', 'Usually none', 'Usually none'],
      ],
    },
  },
  {
    id: 'boundary', time: [60, 75], title: 'Agree on the boundary', slides: 'Slides 9–11 · Exercise C',
    intro: 'Ownership, MVP and how we measure success.',
    asks: [
      { id: 'boundary-truth', q: 'Where is the source of truth, and who is accountable for failures?',
        a: 'Voice agent: lead generation. Worker: delivery, retries, the log. portal-api: keys and subscriptions. Client portal: the firm\'s configuration. Zapier: a consumer, never the source of truth. Operators: exceptions only.' },
      { id: 'boundary-ship', q: 'What can be shipped safely without overcommitting?',
        a: 'Phase 1 (log, resend, 410 handling, Retry-After) with no new concepts; then keys and subscriptions behind a flag; then a private Zapier app with one pilot firm. Each ships dark with a rollback.' },
    ],
    demos: [],
    evidence: 'The lab already runs all of this as separate surfaces: worker (dispatcher), portal-api (/v1), client portal, operator console.',
    ownership: [
      ['Firm authentication', 'portal-api (scoped, revocable API keys)'],
      ['Subscription create/remove', 'portal-api, called by the Zapier app'],
      ['Field mapping', 'Zapier in V2; our connector in V3'],
      ['Delivery, retries, log', 'Worker (one pipeline for all destinations)'],
      ['Setup', 'Firm, self-service; operator fallback'],
      ['Exceptions and resend', 'Operators, from the Delivery Center'],
    ],
    metrics: [
      { id: 'm-minutes', label: 'Operator minutes per firm onboarding' },
      { id: 'm-first-session', label: 'Firms live after the first onboarding session (%)' },
      { id: 'm-eng', label: 'Engineering tickets per onboarding' },
      { id: 'm-first', label: 'Time from setup start to first accepted real lead' },
      { id: 'm-fail', label: 'Delivery failures per 1,000 leads' },
      { id: 'm-tickets', label: 'Support tickets per 100 active integrations' },
    ],
    exercise: 'C',
  },
  {
    id: 'decide', time: [75, 90], title: 'Make decisions', slides: 'Slide 12',
    intro: 'Four decisions, objections invited, owners named. End on one question.',
    asks: [],
    demos: [],
    decisions: true,
  },
];

const BLUEPRINT = [
  { id: 'b1', actor: 'Law firm', step: 'Creates a Zap and sends the webhook URL', v2: 'Adds the Answering AI trigger; Zapier subscribes by itself' },
  { id: 'b2', actor: 'Operator', step: 'Adds the destination and coordinates a sample lead', v2: 'Nothing; the Test step pulls a complete sample from us' },
  { id: 'b3', actor: 'Law firm', step: 'Maps CRM fields and turns the Zap on', v2: 'Same, in Zapier, against a complete sample' },
  { id: 'b4', actor: 'AI system', step: 'Captures and submits a lead', v2: 'Unchanged (contract v1)' },
  { id: 'b5', actor: 'Worker', step: 'Attempts delivery and logs the response', v2: 'Same pipeline; adds 410 switch-off, Retry-After, webhook-id' },
  { id: 'b6', actor: 'Support', step: 'Investigates failures or changed URLs', v2: 'Handles exceptions from the Delivery Center; deleted Zaps unsubscribe themselves' },
];
const BLUEPRINT_COLS = [
  ['start', 'What starts it?'], ['done', 'How do we know it is done?'], ['gone', 'If the person disappears?'],
  ['auto', 'Can the system do it?'], ['owner', 'Who owns a failure?'],
];

const SCENARIOS = [
  { id: 's-clio', title: 'A new firm connects Clio', uncover: 'Authentication, permissions, mapping defaults', lab: 'Partly', demo: 'zapier-self-setup',
    labNote: 'Through Zapier (V2). A direct Clio connection is V3 and not in the lab.' },
  { id: 's-zapier', title: 'A firm uses Zapier instead', uncover: 'Trigger subscription and setup ownership', lab: 'Shown', demo: 'zapier-self-setup',
    labNote: 'Portal → Automation tool → Open Zapier: the app subscribes; no URL is copied.' },
  { id: 's-types', title: 'A firm has different call types', uncover: 'Filtering and routing rules', lab: 'Gap', demo: null,
    labNote: 'Every lead goes to every destination. A call-type filter on the subscription is needed; decide where it lives.' },
  { id: 's-reject', title: 'A CRM rejects a record', uncover: 'Error classification, retry and repair', lab: 'Shown', demo: 'crm-rejects',
    labNote: 'Visible only when the receiver tells us (a webhook or a direct connector). Inside a Zap, Zapier still answers 200.' },
  { id: 's-leaves', title: 'A staff member leaves the firm', uncover: 'Credential ownership and revocation', lab: 'Shown', demo: 'revoke-key',
    labNote: 'Revoking the key switches off the subscriptions it created, with the reason.' },
  { id: 's-change', title: 'A firm changes CRMs', uncover: 'Migration, parallel delivery, rollback', lab: 'Shown', demo: 'change-crm',
    labNote: 'Both destinations get each lead; pause the old one when the firm is ready.' },
];

const CAPABILITIES = [
  { id: 'c-reliable', label: 'Reliable webhook delivery, logs and retries', suggested: 'MVP', where: 'Delivery Center' },
  { id: 'c-cockpit', label: 'Operator onboarding workspace with client review and approval', suggested: 'MVP', where: 'Onboarding + client review link' },
  { id: 'c-keys', label: 'Firm API credentials and managed Zap subscriptions', suggested: 'Next', where: 'Canvas → Zapier app' },
  { id: 'c-sample', label: 'Automatic test lead in Zapier', suggested: 'Next', where: 'Canvas → Test step' },
  { id: 'c-status', label: 'Connection and delivery status in the portal', suggested: 'Next', where: 'Firm portal' },
  { id: 'c-recipes', label: 'Reusable lead recipes and mapping defaults', suggested: 'Next', where: 'Firm portal, steps 3–4' },
  { id: 'c-direct', label: 'Direct CRM connection inside the portal', suggested: 'Later', where: 'Not in the lab (V3)' },
  { id: 'c-verify', label: 'Verify records actually reached a CRM', suggested: 'Later', where: 'Not possible via Zapier' },
  { id: 'c-editor', label: 'Advanced visual workflow editor', suggested: 'Exclude', where: 'Canvas is for engineers only' },
];
const LANES = ['MVP', 'Next', 'Later', 'Exclude'];

const DECISIONS = [
  { id: 'd1', q: 'What experience are we committing to first?', options: ['V2: Native Zapier self-setup', 'V3: In-portal CRM marketplace', 'More discovery required'], proposed: 0 },
  { id: 'd2', q: 'Who owns initial setup?', options: ['Operator-assisted: operator configures, client connects and approves', 'Firm self-service, operator fallback', 'Hybrid by integration type'], proposed: 0 },
  { id: 'd3', q: 'What foundation will we reuse?', options: ['Shared delivery + connections + subscriptions', 'Build only the Zapier-specific solution', 'Evaluate embedded iPaaS first'], proposed: 0 },
  { id: 'd4', q: 'What establishes pilot success?', options: ['Live on the first onboarding session, no engineering ticket, client-confirmed record', 'Independent setup and working lead delivery', 'End-to-end CRM verification'], proposed: 0 },
];

const OBJECTIONS = [
  { id: 'o1', q: 'What existing capability are we duplicating?', a: 'The legacy lead API already has CRM adapters (Clio Grow, Lead Docket, Law Ruler, Lawmatics) with an outbox. Decide reuse vs replace before any direct connector (phase 5).' },
  { id: 'o2', q: 'Could a private Zapier app solve 80% of this without a new platform?', a: 'Largely yes; that is V2. The shared foundation is small: keys, subscriptions and one delivery pipeline we need anyway.' },
  { id: 'o3', q: 'Are we turning a receptionist product into a generic automation platform?', a: 'Not if templates and a workflow editor stay out of scope (variant B parked, editor excluded).' },
  { id: 'o4', q: 'Which parts of CRM setup can we genuinely control?', a: 'In V2: the trigger, the sample, delivery and its log. Not: the Zap\'s mapping, whether it runs, or the CRM record.' },
  { id: 'o5', q: 'What security or data-retention rules could block self-service?', a: 'Hook URLs are untrusted (SSRF checks at save and send), keys must be scoped and revocable, and delivery logs hold caller data: set a retention period before phase 1 ships.' },
];

// ---------- state ----------

function useNotes() {
  const [notes, setNotes] = useState(null);
  const timer = useRef(null);
  useEffect(() => { api('GET', '/admin/workshop').then((n) => setNotes(n ?? {})).catch(() => setNotes({})); }, []);
  const update = (path, value) => {
    setNotes((cur) => {
      const next = structuredClone(cur ?? {});
      let o = next;
      for (const k of path.slice(0, -1)) o = o[k] ??= {};
      o[path.at(-1)] = value;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => api('PUT', '/admin/workshop', next).catch(() => {}), 400);
      return next;
    });
  };
  return [notes, update];
}

const get = (obj, ...path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);

// ---------- pieces ----------

function Note({ value, onChange, label, rows = 2, placeholder }) {
  return html`<textarea className="note-input" aria-label=${label} rows=${rows} placeholder=${placeholder ?? 'What the room said…'}
    value=${value ?? ''} onChange=${(e) => onChange(e.target.value)}></textarea>`;
}

function Ask({ item, notes, update }) {
  return html`
    <div className="ask">
      <p className="ask-q">${item.q}</p>
      <${Note} label=${item.q} value=${get(notes, 'answers', item.id)} onChange=${(v) => update(['answers', item.id], v)} />
      <details className="proposed"><summary>Prepared answer (open after the room speaks)</summary><p>${item.a}</p></details>
    </div>`;
}

function DemoButton({ id, run }) {
  return html`<button className="btn demo" onClick=${() => run(id)}>▶ ${DEMOS[id]}</button>`;
}

function Blueprint({ notes, update }) {
  const [future, setFuture] = useState(false);
  return html`
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Exercise A · Service blueprint</h2>
        <label className="row small"><input type="checkbox" checked=${future} onChange=${(e) => setFuture(e.target.checked)} /> Show the V2 future state</label>
      </div>
      <p className="muted small">For each handoff, ask: what starts it, how do we know it is done, what if the person disappears, can the system do it, who owns a failure?</p>
      <div className="table-wrap">
        <table className="grid-table">
          <thead><tr><th>Actor</th><th>What happens today</th>${future && html`<th>V2</th>`}${BLUEPRINT_COLS.map(([, l]) => html`<th key=${l}>${l}</th>`)}</tr></thead>
          <tbody>
            ${BLUEPRINT.map((r) => html`
              <tr key=${r.id}>
                <td><strong>${r.actor}</strong></td>
                <td>${r.step}</td>
                ${future && html`<td className="v2">${r.v2}</td>`}
                ${BLUEPRINT_COLS.map(([k, l]) => html`<td key=${k}><${Note} rows=${2} label=${`${r.step}: ${l}`} placeholder="…" value=${get(notes, 'blueprint', r.id, k)} onChange=${(v) => update(['blueprint', r.id, k], v)} /></td>`)}
              </tr>`)}
          </tbody>
        </table>
      </div>
    </div>`;
}

function ScenarioCards({ notes, update, run }) {
  const fields = [['outcome', 'Business outcome'], ['actor', 'Primary actor'], ['expected', 'Expected behavior'], ['failure', 'Failure behavior'], ['evidence', 'Evidence of success']];
  return html`
    <div className="card">
      <div className="card-head"><h2 className="grow">Exercise B · Requirements by scenario</h2></div>
      <div className="scen-grid">
        ${SCENARIOS.map((s) => html`
          <article key=${s.id} className="scen">
            <header>
              <strong>${s.title}</strong>
              <span className=${`badge ${s.lab === 'Shown' ? 'ok' : s.lab === 'Partly' ? 'warn' : 'bad'}`}>Lab: ${s.lab}</span>
            </header>
            <p className="muted small">Uncover: ${s.uncover}</p>
            <p className="small lab-note">${s.labNote}</p>
            ${s.demo && html`<${DemoButton} id=${s.demo} run=${run} />`}
            ${fields.map(([k, l]) => html`
              <label key=${k} className="field small">${l}
                <${Note} rows=${1} label=${`${s.title}: ${l}`} placeholder="…" value=${get(notes, 'scenarios', s.id, k)} onChange=${(v) => update(['scenarios', s.id, k], v)} />
              </label>`)}
            <label className="field small">Priority
              <select value=${get(notes, 'scenarios', s.id, 'priority') ?? ''} onChange=${(e) => update(['scenarios', s.id, 'priority'], e.target.value)}>
                <option value="">—</option><option>Must</option><option>Should</option><option>Could</option><option>Won't</option>
              </select>
            </label>
          </article>`)}
      </div>
    </div>`;
}

function PriorityBoard({ notes, update }) {
  const lane = (c) => get(notes, 'priorities', c.id) ?? c.suggested;
  const mvp = CAPABILITIES.filter((c) => lane(c) === 'MVP').length;
  return html`
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Exercise C · Minimum viable experience</h2>
        <span className="badge muted">${mvp} MVP capabilities</span>
        <button className="btn" onClick=${() => update(['priorities'], {})}>Reset to suggested</button>
      </div>
      <p className="muted small">Starting positions are suggestions. Move them while the room argues; define the MVP as an outcome, for example: "a firm connects an Answering AI Zap, tests it, turns it on and receives a real lead with no operator editing account config."</p>
      <div className="lanes">
        ${LANES.map((l) => html`
          <div key=${l} className=${`lane lane-${l.toLowerCase()}`}>
            <h3>${l}</h3>
            ${CAPABILITIES.filter((c) => lane(c) === l).map((c) => html`
              <div key=${c.id} className="cap">
                <span>${c.label}</span>
                <small className="muted">${c.where}${lane(c) !== c.suggested ? ` · suggested: ${c.suggested}` : ''}</small>
                <div className="seg" role="radiogroup" aria-label=${c.label}>
                  ${LANES.map((x) => html`<button key=${x} role="radio" aria-checked=${lane(c) === x} className=${lane(c) === x ? 'on' : ''} onClick=${() => update(['priorities', c.id], x)}>${x}</button>`)}
                </div>
              </div>`)}
          </div>`)}
      </div>
    </div>`;
}

function Decisions({ notes, update }) {
  const final = get(notes, 'final') ?? [{ condition: '', evidence: '', owner: '' }];
  return html`
    <div className="card">
      <div className="card-head"><h2 className="grow">Decision record</h2></div>
      <div className="dec-grid">
        ${DECISIONS.map((d) => {
          const choice = get(notes, 'decisions', d.id, 'choice');
          return html`
            <fieldset key=${d.id} className="dec">
              <legend>${d.q}</legend>
              ${d.options.map((o, i) => html`
                <label key=${o} className=${`opt ${choice === o ? 'on' : ''}`}>
                  <input type="radio" name=${d.id} checked=${choice === o} onChange=${() => update(['decisions', d.id, 'choice'], o)} />
                  ${o}${i === d.proposed && html` <span className="badge muted">proposed</span>`}
                </label>`)}
              <${Note} rows=${2} label=${`${d.q}: why`} placeholder="Why, and what would change our mind" value=${get(notes, 'decisions', d.id, 'why')} onChange=${(v) => update(['decisions', d.id, 'why'], v)} />
              <input className="owner" aria-label=${`${d.q}: owner`} placeholder="Owner" value=${get(notes, 'decisions', d.id, 'owner') ?? ''} onChange=${(e) => update(['decisions', d.id, 'owner'], e.target.value)} />
            </fieldset>`;
        })}
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h2 className="grow">Objections (invite them)</h2></div>
      ${OBJECTIONS.map((o) => html`<${Ask} key=${o.id} item=${{ id: o.id, q: o.q, a: o.a }} notes=${notes} update=${update} />`)}
    </div>

    <div className="card final">
      <h2>What must be true for the next 100 law firms to connect their CRM without an engineer or operator?</h2>
      <div className="table-wrap">
        <table className="grid-table">
          <thead><tr><th>Condition</th><th>Evidence</th><th>Owner</th><th></th></tr></thead>
          <tbody>
            ${final.map((r, i) => html`
              <tr key=${i}>
                ${['condition', 'evidence', 'owner'].map((k) => html`<td key=${k}><${Note} rows=${1} label=${`Row ${i + 1} ${k}`} placeholder="…" value=${r[k]} onChange=${(v) => update(['final'], final.map((x, j) => (j === i ? { ...x, [k]: v } : x)))} /></td>`)}
                <td><button className="btn icon" aria-label="Remove row" onClick=${() => update(['final'], final.filter((_, j) => j !== i))}>✕</button></td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      <button className="btn" onClick=${() => update(['final'], [...final, { condition: '', evidence: '', owner: '' }])}>Add condition</button>
    </div>`;
}

// ---------- export ----------

function toMarkdown(notes) {
  const n = notes ?? {};
  const out = [`# Workshop record: From Webhooks to Self-Service Integrations`, '', `Exported ${new Date().toLocaleString()}`, ''];
  out.push('## Decisions', '');
  for (const d of DECISIONS) {
    const x = get(n, 'decisions', d.id) ?? {};
    out.push(`- **${d.q}** ${x.choice ?? '_undecided_'}${x.owner ? ` (owner: ${x.owner})` : ''}${x.why ? `\n  - Why: ${x.why}` : ''}`);
  }
  out.push('', '## Answers by agenda block', '');
  for (const s of SECTIONS) {
    if (!s.asks.length) continue;
    out.push(`### ${s.title}`, '');
    for (const a of s.asks) out.push(`- **${a.q}**`, `  - Room: ${get(n, 'answers', a.id) || '_no notes_'}`);
    out.push('');
  }
  out.push('## Service blueprint (current state)', '', `| Actor | Step | ${BLUEPRINT_COLS.map(([, l]) => l).join(' | ')} |`, `|${'---|'.repeat(BLUEPRINT_COLS.length + 2)}`);
  for (const r of BLUEPRINT) out.push(`| ${r.actor} | ${r.step} | ${BLUEPRINT_COLS.map(([k]) => (get(n, 'blueprint', r.id, k) ?? '').replace(/\n/g, ' ')).join(' | ')} |`);
  out.push('', '## Requirements by scenario', '');
  for (const s of SCENARIOS) {
    const x = get(n, 'scenarios', s.id) ?? {};
    out.push(`### ${s.title} — ${x.priority || 'unprioritized'} (lab: ${s.lab})`, '');
    for (const [k, l] of [['outcome', 'Outcome'], ['actor', 'Actor'], ['expected', 'Expected'], ['failure', 'Failure'], ['evidence', 'Evidence']]) out.push(`- ${l}: ${x[k] || '—'}`);
    out.push('');
  }
  out.push('## Capability priorities', '');
  for (const l of LANES) {
    const caps = CAPABILITIES.filter((c) => (get(n, 'priorities', c.id) ?? c.suggested) === l);
    if (caps.length) out.push(`- **${l}:** ${caps.map((c) => c.label).join('; ')}`);
  }
  out.push('', '## Success metrics', '', '| Metric | Baseline | Pilot target |', '|---|---|---|');
  for (const m of SECTIONS.find((s) => s.metrics).metrics) out.push(`| ${m.label} | ${get(n, 'metrics', m.id, 'baseline') ?? ''} | ${get(n, 'metrics', m.id, 'target') ?? ''} |`);
  out.push('', '## Objections', '');
  for (const o of OBJECTIONS) out.push(`- **${o.q}** ${get(n, 'answers', o.id) || '_not raised_'}`);
  out.push('', '## What must be true for the next 100 firms', '', '| Condition | Evidence | Owner |', '|---|---|---|');
  for (const r of get(n, 'final') ?? []) out.push(`| ${r.condition ?? ''} | ${r.evidence ?? ''} | ${r.owner ?? ''} |`);
  return out.join('\n');
}

// ---------- page ----------

function Workshop() {
  const [notes, update] = useNotes();
  const { act, say, view: toast } = useToast();
  const [section, setSection] = useState(() => location.hash.slice(1) || 'frame');
  const [lastDemo, setLastDemo] = useState(null);
  const [, tick] = useState(0);
  const labWindow = useRef(null);

  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { history.replaceState(null, '', `#${section}`); }, [section]);

  if (!notes) return html`<p className="boot">Loading…</p>`;

  const startedAt = notes.startedAt ?? null;
  const elapsedMin = startedAt ? (Date.now() - startedAt) / 60000 : null;
  const live = elapsedMin == null ? null : SECTIONS.find((s) => elapsedMin >= s.time[0] && elapsedMin < s.time[1])?.id;
  const mmss = (m) => `${Math.floor(m)}:${String(Math.floor((m % 1) * 60)).padStart(2, '0')}`;

  const run = async (id) => {
    const r = await act(() => api('POST', `/admin/scenarios/${id}`));
    if (!r) return;
    setLastDemo({ id, ...r });
    say(`${DEMOS[id]}: ${r.note}`);
    labWindow.current = window.open(r.open, 'webhook-lab-view');
  };

  const s = SECTIONS.find((x) => x.id === section) ?? SECTIONS[0];
  const md = section === 'export' ? toMarkdown(notes) : '';

  return html`
    <div className="shell">
      <header className="shell-top">
        <div className="brand"><span className="logo">◉</span> Workshop <span className="sep"></span> <span className="muted">From Webhooks to Self-Service Integrations</span></div>
        <div className="spacer"></div>
        <div className="timer">
          ${startedAt ? html`<span className="mono">${mmss(elapsedMin)} / 90:00</span>` : html`<span className="muted small">90 min</span>`}
          <button className="btn" onClick=${() => update(['startedAt'], startedAt ? null : Date.now())}>${startedAt ? 'Stop' : 'Start meeting'}</button>
        </div>
        <nav className="views" aria-label="Lab views">
          <a href="/workshop.html" aria-current="page">Workshop</a><a href="/" target="webhook-lab-view">Canvas</a>
          <a href="/portal.html" target="webhook-lab-view">Firm portal</a><a href="/onboard.html" target="webhook-lab-view">Onboarding</a><a href="/ops.html" target="webhook-lab-view">Delivery Center</a>
        </nav>
      </header>

      <aside className="shell-nav agenda" aria-label="Agenda">
        ${SECTIONS.map((x) => html`
          <a key=${x.id} href=${`#${x.id}`} className=${`navlink ${section === x.id ? 'on' : ''} ${live === x.id ? 'live' : ''}`}
            aria-current=${section === x.id ? 'step' : undefined} onClick=${(e) => { e.preventDefault(); setSection(x.id); }}>
            <span className="mono small">${x.time[0]}–${x.time[1]}</span><span>${x.title}</span>
          </a>`)}
        <a href="#export" className=${`navlink ${section === 'export' ? 'on' : ''}`} onClick=${(e) => { e.preventDefault(); setSection('export'); }}>
          <span className="mono small">after</span><span>Export the record</span>
        </a>
        <div className="agenda-foot">
          <button className="btn wide" onClick=${() => { if (confirm('Reset the lab to the two demo firms? Notes are kept.')) act(() => api('POST', '/admin/reset'), 'Lab reset to the demo'); }}>Reset lab demo</button>
          <p className="muted small">Demos open in one reusable tab. Put it on the shared screen.</p>
        </div>
      </aside>

      <main className="shell-main">
        ${section === 'export' ? html`
          <h1>Export the record</h1>
          <p className="muted">Seeds the PRD, the decision record and the backlog. Notes are saved in <code>workshop-notes.json</code>.</p>
          <div className="row">
            <button className="btn primary" onClick=${() => { void navigator.clipboard?.writeText(md); say('Copied as Markdown'); }}>Copy Markdown</button>
            <a className="btn" download="workshop-record.md" href=${`data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`}>Download .md</a>
          </div>
          <pre className="out export">${md}</pre>`
        : html`
          <div className="sec-head">
            <span className="badge muted">${s.time[0]}–${s.time[1]} min · ${s.slides}</span>
            ${live === s.id && html`<span className="badge ok">Now</span>`}
          </div>
          <h1>${s.title}</h1>
          <p className="muted">${s.intro}</p>

          ${(s.demos.length > 0 || s.evidence) && html`
            <div className="card demo-card">
              <div className="card-head"><h2 className="grow">Show it in the lab</h2></div>
              <div className="row">${s.demos.map((d) => html`<${DemoButton} key=${d} id=${d} run=${run} />`)}</div>
              ${s.evidence && html`<p className="small"><strong>What to point at:</strong> ${s.evidence}</p>`}
              ${lastDemo && html`<p className="small ok">Last run: ${DEMOS[lastDemo.id]} — ${lastDemo.note}</p>`}
            </div>`}

          ${s.asks.length > 0 && html`
            <div className="card">
              <div className="card-head"><h2 className="grow">Ask the room</h2></div>
              ${s.asks.map((a) => html`<${Ask} key=${a.id} item=${a} notes=${notes} update=${update} />`)}
            </div>`}

          ${s.table && html`
            <div className="card"><div className="table-wrap"><table className="grid-table compare">
              <thead><tr>${s.table.head.map((h) => html`<th key=${h}>${h}</th>`)}</tr></thead>
              <tbody>${s.table.rows.map((r) => html`<tr key=${r[0]}>${r.map((c, i) => html`<td key=${i} className=${i === 2 ? 'v2' : ''}>${i === 0 ? html`<strong>${c}</strong>` : c}</td>`)}</tr>`)}</tbody>
            </table></div></div>`}

          ${s.ownership && html`
            <div className="card">
              <div className="card-head"><h2 className="grow">Ownership (proposed)</h2></div>
              <table className="grid-table"><tbody>
                ${s.ownership.map(([k, v]) => html`<tr key=${k}><td><strong>${k}</strong></td><td>${v}</td><td><${Note} rows=${1} label=${`${k}: room`} placeholder="Agree? Change?" value=${get(notes, 'ownership', k)} onChange=${(x) => update(['ownership', k], x)} /></td></tr>`)}
              </tbody></table>
            </div>`}

          ${s.metrics && html`
            <div className="card">
              <div className="card-head"><h2 className="grow">Success metrics</h2><span className="muted small">Measure the V1 baseline before the pilot</span></div>
              <table className="grid-table"><thead><tr><th>Metric</th><th>Baseline (V1 today)</th><th>Pilot target</th></tr></thead><tbody>
                ${s.metrics.map((m) => html`<tr key=${m.id}><td>${m.label}</td>
                  ${['baseline', 'target'].map((k) => html`<td key=${k}><input aria-label=${`${m.label} ${k}`} value=${get(notes, 'metrics', m.id, k) ?? ''} onChange=${(e) => update(['metrics', m.id, k], e.target.value)} /></td>`)}
                </tr>`)}
              </tbody></table>
            </div>`}

          ${s.exercise === 'A' && html`<${Blueprint} notes=${notes} update=${update} />`}
          ${s.exercise === 'B' && html`<${ScenarioCards} notes=${notes} update=${update} run=${run} />`}
          ${s.exercise === 'C' && html`<${PriorityBoard} notes=${notes} update=${update} />`}
          ${s.decisions && html`<${Decisions} notes=${notes} update=${update} />`}

          <div className="row end">
            ${SECTIONS.indexOf(s) > 0 && html`<button className="btn" onClick=${() => setSection(SECTIONS[SECTIONS.indexOf(s) - 1].id)}>← Back</button>`}
            <button className="btn primary" onClick=${() => setSection(SECTIONS[SECTIONS.indexOf(s) + 1]?.id ?? 'export')}>Next →</button>
          </div>`}
      </main>
      ${toast}
    </div>`;
}

createRoot(document.getElementById('root')).render(html`<${Workshop} />`);
