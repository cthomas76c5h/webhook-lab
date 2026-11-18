// PROTOTYPE: operator console for the webhook lab. Renders the server's
// snapshot (pushed over SSE) and calls the /admin and /v1 routes.

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

let state = null;
let firmId = null;
const openDetails = new Set();

// ---------- API ----------

async function api(method, path, body, headers = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

function toast(message, bad = false) {
  const t = $('#toast');
  t.textContent = message;
  t.style.background = bad ? 'var(--bad)' : '';
  $('#status').textContent = message;
  try { t.showPopover(); } catch { /* already open */ }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { try { t.hidePopover(); } catch { /* closed */ } }, 3500);
}

async function act(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

// ---------- render ----------

function render() {
  if (!state) return;
  const firms = state.firms;
  if (!firms.some((f) => f.id === firmId)) firmId = firms[0]?.id ?? null;
  const sel = $('#firm');
  sel.innerHTML = firms.map((f) => `<option value="${f.id}" ${f.id === firmId ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  const firm = firms.find((f) => f.id === firmId);
  $('#apikey').textContent = firm?.apiKey ?? '—';

  const s = state.config;
  $('#schedule').textContent =
    `Retries after ${s.scheduleMs.map((ms) => (ms >= 3_600_000 ? `${ms / 3_600_000}h` : ms >= 60_000 ? `${ms / 60_000}m` : `${ms / 1000}s`)).join(', ')} ` +
    `(±20%). Running ${s.timeScale}× faster. Timeout ${s.timeoutMs / 1000}s.`;

  renderEndpoints();
  renderDeliveries();
  renderInbox();
  renderModes();
}

function renderEndpoints() {
  const eps = state.endpoints.filter((e) => e.firmId === firmId);
  $('#endpoints').innerHTML = eps.length
    ? eps.map((e) => `
      <article class="card" data-status="${e.status}">
        <header>
          <strong>${esc(e.name)}</strong>
          <span class="chip ${e.status}">${e.status === 'active' ? 'on' : 'off'}</span>
          <span class="chip test">${e.source === 'rest-hook' ? 'subscribed by app' : 'pasted by hand'}</span>
          ${e.template ? '<span class="chip test">custom body</span>' : ''}
        </header>
        <div class="url">${esc(e.url)}</div>
        ${e.hint ? `<div class="muted">${esc(e.hint)}</div>` : ''}
        ${e.disabledReason ? `<div class="warn">Off: ${esc(e.disabledReason)}. New leads are not sent here until you turn it on.</div>` : ''}
        <div class="muted">Signing secret${e.secrets.length > 1 ? 's (rotating: both sign every request)' : ''}:
          ${e.secrets.map((x) => `<code>${esc(x.slice(0, 12))}…</code>`).join(' ')}</div>
        <div class="actions">
          ${e.status === 'active'
            ? `<button type="button" data-act="test" data-id="${e.id}">Send sample lead</button>`
            : `<button type="button" data-act="enable" data-id="${e.id}" class="primary">Turn on</button>`}
          <button type="button" data-act="template" data-id="${e.id}">Body…</button>
          <button type="button" data-act="rotate" data-id="${e.id}">Rotate secret</button>
          <button type="button" data-act="remove" data-id="${e.id}" class="danger">Remove</button>
        </div>
      </article>`).join('')
    : '<p class="muted">No endpoints. Add one, or turn on a Zap in the Zapier app flow.</p>';
}

function deliveryLine(d) {
  if (d.status === 'pending' && d.nextAttemptAt) {
    const s = Math.max(0, Math.ceil((d.nextAttemptAt - Date.now()) / 1000));
    return d.attempts.length ? `retry ${d.attempts.length + 1} in ${s}s (${esc(d.reason)})` : 'queued';
  }
  if (d.status === 'delivered') return `delivered on try ${d.attempts.length}`;
  return esc(d.reason ?? d.status);
}

function renderDeliveries() {
  const eps = new Map(state.endpoints.map((e) => [e.id, e]));
  const rows = state.deliveries.filter((d) => {
    const ep = eps.get(d.endpointId);
    return !ep || ep.firmId === firmId;
  });
  if (!rows.length) {
    $('#deliveries').innerHTML = '<p class="muted">Nothing sent yet. Simulate a call, or send a sample lead.</p>';
    return;
  }
  $('#deliveries').innerHTML = `
    <table>
      <thead><tr><th>When</th><th>Lead</th><th class="hide-narrow">Endpoint</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((d) => `
        <tr>
          <td>${ago(d.createdAt)}</td>
          <td>${esc(d.lead)} ${d.test ? '<span class="chip test">sample</span>' : ''}
            <details data-id="${d.id}" ${openDetails.has(d.id) ? 'open' : ''}>
              <summary>${d.attempts.length} attempt${d.attempts.length === 1 ? '' : 's'}</summary>
              ${d.attempts.map((a) => `
                <div class="attempt" data-ok="${a.outcome === 'delivered'}">
                  <div>#${a.n} · ${a.status ? `HTTP ${a.status}` : esc(a.error)} · ${a.durationMs} ms · <strong>${esc(a.outcome)}</strong></div>
                  <details><summary>Request</summary><pre class="out">${esc(Object.entries(a.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n'))}\n\n${esc(prettyJson(a.requestBody))}</pre></details>
                  ${a.responseSnippet ? `<details><summary>Response</summary><pre class="out">${esc(a.responseSnippet)}</pre></details>` : ''}
                </div>`).join('')}
            </details>
          </td>
          <td class="hide-narrow">${esc(eps.get(d.endpointId)?.name ?? '(removed)')}</td>
          <td><span class="chip ${d.status}">${d.status}</span><div class="muted">${deliveryLine(d)}</div></td>
          <td>${['failed', 'cancelled', 'delivered'].includes(d.status) ? `<button type="button" data-act="replay" data-id="${d.id}">Resend</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderInbox() {
  $('#inbox').innerHTML = state.received.length
    ? `<table><thead><tr><th>When</th><th>Receiver</th><th>webhook-id</th><th>Signature</th><th>Answered</th></tr></thead><tbody>
      ${state.received.map((r) => `
        <tr>
          <td>${ago(r.at)}</td>
          <td>${esc(r.mode)}</td>
          <td><code>${esc(r.webhookId)}</code>${r.duplicate ? ' <span class="chip pending" title="A real receiver would answer 200 and not act twice">duplicate</span>' : ''}</td>
          <td class="${r.verified.startsWith('valid') ? '' : 'warn'}">${esc(r.verified)}</td>
          <td>${esc(r.answered)}</td>
        </tr>`).join('')}</tbody></table>`
    : '<p class="muted">The fake receivers have not been called yet.</p>';
}

function renderModes() {
  const box = $('#modes');
  if (box.childElementCount) return;
  box.innerHTML = Object.entries(state.modes)
    .map(([m, d]) => `<button type="button" data-mode="${m}"><strong>${m}</strong> — ${esc(d)}</button>`)
    .join('');
}

function prettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// ---------- events ----------

new EventSource('/admin/stream').onmessage = (e) => {
  state = JSON.parse(e.data);
  render();
};
setInterval(() => {
  if (state?.deliveries.some((d) => d.status === 'pending')) renderDeliveries();
}, 1000);

$('#firm').addEventListener('change', (e) => { firmId = e.target.value; render(); });
$('#call').addEventListener('click', () => act(() => api('POST', '/admin/calls', { firmId }), 'Call ended: lead published'));
$('#hangup').addEventListener('click', () => act(() => api('POST', '/admin/calls', { firmId, variant: 'sparse' }), 'Hang-up: sparse lead published'));
$('#reset').addEventListener('click', () => act(() => api('POST', '/admin/reset'), 'Lab reset'));

document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.matches?.('details[data-id]')) d.open ? openDetails.add(d.dataset.id) : openDetails.delete(d.dataset.id);
}, true);

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  const run = {
    test: () => act(() => api('POST', `/admin/endpoints/${id}/test`, {}), 'Sample lead queued'),
    enable: () => act(() => api('PATCH', `/admin/endpoints/${id}`, { status: 'active' }), 'Endpoint on'),
    rotate: () => act(() => api('POST', `/admin/endpoints/${id}/rotate`), 'New secret: both secrets sign for the overlap'),
    remove: () => act(() => api('DELETE', `/admin/endpoints/${id}`), 'Endpoint removed'),
    replay: () => act(() => api('POST', `/admin/deliveries/${id}/replay`), 'Resent with the same webhook-id'),
    template: () => openTemplate(id),
  }[b.dataset.act];
  run?.();
});

// ---------- Zapier app flow ----------

const firmKey = () => ({ 'x-api-key': state.firms.find((f) => f.id === firmId)?.apiKey ?? '' });
let lastHookId = null;
const show = (label, data) => { $('#z-out').textContent = `${label}\n\n${JSON.stringify(data, null, 2)}`; };

$('#z-me').addEventListener('click', async () => {
  const r = await act(() => api('GET', '/v1/me', undefined, firmKey()));
  if (r) show('GET /v1/me', r);
});
$('#z-sub').addEventListener('click', async () => {
  const target_url = `${state.config.origin}/receiver/ok`;
  const r = await act(() => api('POST', '/v1/hooks', { target_url, event: 'lead.created' }, firmKey()), 'Zap on: endpoint created by the app');
  if (r) { lastHookId = r.id; show(`POST /v1/hooks  { target_url: "${target_url}" }`, r); }
});
$('#z-unsub').addEventListener('click', async () => {
  const id = lastHookId ?? state.endpoints.find((e) => e.firmId === firmId && e.source === 'rest-hook')?.id;
  if (!id) return toast('No subscribed Zap for this firm', true);
  const r = await act(() => api('DELETE', `/v1/hooks/${id}`, undefined, firmKey()), 'Zap off: endpoint removed by the app');
  if (r) { lastHookId = null; show(`DELETE /v1/hooks/${id}`, r); }
});
$('#z-samples').addEventListener('click', async () => {
  const r = await act(() => api('GET', '/v1/samples/lead.created', undefined, firmKey()));
  if (r) show('GET /v1/samples/lead.created  (Zapier Test step)', r);
});

// ---------- Add endpoint dialog ----------

const addDialog = $('#add-endpoint');
$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  $('#ep-url').value = `${state.config.origin}/receiver/${b.dataset.mode}`;
  if (!$('#ep-name').value) $('#ep-name').value = `Fake: ${b.dataset.mode}`;
});
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const server = $('#ep-url-server');
  server.hidden = true;
  const url = $('#ep-url');
  try {
    await api('POST', '/admin/endpoints', { firmId, name: $('#ep-name').value, url: url.value });
    e.target.reset();
    addDialog.close();
    toast('Endpoint added');
  } catch (err) {
    server.textContent = err.message;
    server.hidden = false;
    url.setAttribute('aria-invalid', 'true');
    url.setAttribute('aria-describedby', 'ep-url-server');
    url.focus();
  }
});

// ---------- Template dialog ----------

const tplDialog = $('#template-dialog');
let tplEndpoint = null;
let previewTimer;
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

function openTemplate(id) {
  tplEndpoint = state.endpoints.find((e) => e.id === id);
  $('#tpl').value = tplEndpoint?.template ?? '';
  $('#tpl-title').textContent = `Body template — ${tplEndpoint?.name ?? ''}`;
  tplDialog.showModal();
  preview();
}

async function preview() {
  if (!tplEndpoint) return;
  const r = await api('POST', `/admin/endpoints/${tplEndpoint.id}/preview`, { template: $('#tpl').value, variant: $('#tpl-variant').value }).catch((e) => ({ body: '', errors: [e.message], used: [], vars: [] }));
  $('#tpl-preview').textContent = r.body;
  $('#tpl-errors').innerHTML = r.errors.map((x) => `<li>${esc(x)}</li>`).join('');
  $('#tpl').setAttribute('aria-invalid', r.errors.length ? 'true' : 'false');
  $('#chips').innerHTML = r.vars
    .filter((v) => v !== 'schema_version')
    .map((v) => `<button type="button" data-var="${v}" ${r.used.includes(v) ? 'data-used' : ''}>${v}</button>`)
    .join('');
}

$('#tpl').addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 200); });
$('#tpl-variant').addEventListener('change', preview);
$('#tpl-preset').addEventListener('click', () => { $('#tpl').value = PRESET; preview(); });
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-var]');
  if (!b) return;
  const t = $('#tpl');
  const token = `{{${b.dataset.var}}}`;
  t.setRangeText(token, t.selectionStart, t.selectionEnd, 'end');
  t.focus();
  preview();
});
$('#tpl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await act(() => api('PATCH', `/admin/endpoints/${tplEndpoint.id}`, { template: $('#tpl').value }), 'Body template saved');
  if (ok) tplDialog.close();
});

// ---------- platform fallbacks ----------

// <dialog closedby="any"> light dismiss where it is not supported (Safari).
if (!('closedBy' in HTMLDialogElement.prototype)) {
  for (const d of document.querySelectorAll('dialog[closedby="any"]')) {
    d.addEventListener('click', (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) d.close();
    });
  }
}

// Keep aria-invalid in step with :user-invalid, so screen readers hear an
// error only after the user has touched the field.
const syncAria = (el) => {
  if (!el.matches?.('#add-form input')) return;
  const invalid = el.matches(':user-invalid');
  el.setAttribute('aria-invalid', String(invalid));
  const err = el.dataset.error;
  if (err) invalid ? el.setAttribute('aria-describedby', err) : el.removeAttribute('aria-describedby');
};
document.querySelectorAll('#add-form input').forEach((el) => el.setAttribute('aria-invalid', 'false'));
document.addEventListener('blur', (e) => syncAria(e.target), true);
document.addEventListener('input', (e) => { $('#ep-url-server').hidden = true; syncAria(e.target); });
document.addEventListener('invalid', (e) => syncAria(e.target), true);
