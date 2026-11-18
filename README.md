# Webhook lab (prototype)

A throwaway service for exploring how Answering AI should deliver leads to
webhooks — Zapier first, any receiver later. In-memory only; restart wipes it.

```sh
npm start          # http://localhost:4040  (Node 22.18+; no install step, no dependencies)
npm test
```

Env: `PORT` (4040), `TIME_SCALE` (600: retries run 600× faster), `TIMEOUT_MS`
(5000), `ALLOW_LOCAL_TARGETS` (true: lets endpoints point at the fake receivers
on localhost).

The default page is a canvas in the style of the admin call flow editor (React
Flow + dagre, the same versions, loaded from a CDN through an import map, so
there is still no build step). Drag a receiver from the left onto the canvas to
add an endpoint; drag cards to move them; select a card and drag its corners to
resize; double-click a name to rename; **Auto layout** tidies it. The list view
is still at `/classic.html`.

Three views of the same live data:

| Page | For | Shows |
|---|---|---|
| `/` Canvas | Engineers | The delivery graph: firms, Zapier app, endpoints, receivers |
| `/portal.html` Firm portal | Law firm staff | Connect a destination, choose a recipe, map fields, send a test (V2 path: Zapier; V3 path "Legal CRM (direct)" is marked Planned) |
| `/ops.html` Delivery Center | Operators | KPI tiles, delivery log across firms, a lead drawer with Resend, Edit mapping, Pause |

| `/onboard.html` Onboarding | Operators | The assisted-onboarding MVP: a queue by setup state with the next action, and one shared setup record per firm (recipe, prefilled or cloned mapping, secure client link, versioned approval, test, client confirmation, go-live, history). Until go-live only test leads reach the destination |
| `/review.html?t=…` Client review | Firm admin | Opened from the operator's secure link: connect (paste the hook address or connect the Zapier app), see what will be shared with a sample, approve or ask for changes. Approval covers one version |
| `/workshop.html` Workshop | Facilitator | The 90-minute alignment meeting: agenda and timer, questions with prepared answers (closed until the room speaks), one-click staged situations that open in a shared tab, Exercises A–C, decisions, and a Markdown export of everything said |

Workshop notes save to `workshop-notes.json` (gitignored) and survive a
restart; the lab data does not. Run **Reset lab demo** before the meeting.

Statuses only claim what we can prove: **Accepted** (the receiver took it),
never "in the CRM". A connection is **Waiting for first lead** until a real lead
is accepted; a sample does not count.

## Stakeholder demo (seeded)

One platform, two firms, no code per firm:

1. **Firm A** (personal injury): Simulate call → the lead reaches its Zap.
2. **Firm B** (family law): Simulate call → the receiver refuses it
   (`Phone is required`). The delivery shows its journey and a **Next action**.
3. Fix Firm B's **Body** (add `"Phone": "{{phone}}"`), then **Resend** → accepted.

"Accepted" means the receiver (Zapier) took the lead. Whether it reached the
CRM is not visible to us; the journey shows that step as unknown on purpose.

## Things to try

1. **Simulate a call.** One lead fans out to each active endpoint of the firm.
2. **Add an endpoint per fake receiver** (`flaky`, `ratelimited`, `gone`,
   `reject`, `redirect`, `slow`) and simulate a call. Watch each delivery's
   attempts, outcome, and next retry.
3. **Resend** a delivered lead: the receiver inbox flags it as a duplicate,
   because the `webhook-id` is the same.
4. **Rotate a secret**, then send a sample: both signatures go out until the
   overlap ends.
5. **Body…** on an endpoint: write a free-form template, insert fields, preview
   against a full lead and a hang-up.
6. **Zapier app flow**: turn a Zap on and off and run the Test step, using the
   calls a Zapier app's trigger would make.

## Decisions this lab makes explicit

| Question | Answer here | Why |
|---|---|---|
| Delivery guarantee | At least once | Exactly once is not possible over HTTP; receivers dedupe on `webhook-id` (= event id, the same on every retry and resend). |
| Signing | [Standard Webhooks](https://www.standardwebhooks.com/) headers, HMAC-SHA256 over `id.timestamp.body` | A common spec with verifier libraries; the timestamp blocks replays; several signatures allow rotation without a gap. |
| Retry | 5s, 1m, 5m, 30m, 2h, 6h, 12h (±20% jitter), honour `Retry-After` | Rides out an overnight outage; jitter stops a recovering receiver from being hit by every retry at once. |
| Retryable | No answer, timeout, 408, 425, 429, 5xx | Temporary by definition. |
| Stop now | Other 4xx; 3xx (redirects are not followed) | Sending the same body again gets the same answer; a redirect could take the lead to an address nobody checked. |
| Switch off the endpoint | 410 Gone, or 5 leads in a row failed | 410 is how Zapier says "this hook was deleted". A switched-off endpoint shows why, and stays off until someone turns it on. |
| Address safety | https only; no user info; resolve and refuse private, loopback, link-local and CGNAT ranges at save **and** send time | The firm supplies the address, so it is untrusted (SSRF). DNS can change after save. |
| Body | Standard flat body (the platform's 17 fields + `event`, `event_id`), or a free-form template | Zapier flattens nested JSON anyway; flat keys map one to one. |
| Templates | `{{field}}`, `{{field\|default:'x'}}`, values JSON-escaped, checked against a full and a sparse lead on save; a missing `intake.*` field renders empty | A template that only works when every field is filled breaks on the first hang-up; intake fields differ per call type. |
| A broken template | Fails the delivery at once, no retry | It will not fix itself. |
| Zapier hand-off | REST hooks: `POST /v1/hooks` (subscribe), `DELETE /v1/hooks/:id` (unsubscribe), `GET /v1/samples/lead.created` (Test step), `GET /v1/me` (auth), with a per-firm `x-api-key` | No URL copy and paste; sample data is complete and available at any time; a deleted Zap removes its own endpoint. |

## Open questions

- Per-firm API key vs portal OAuth for the Zapier app.
- Which call types a subscribed Zap receives (all, or a trigger filter).
- Where the outbox lives: the platform's existing `calls.deliveries` +
  BullMQ job, or a separate service with its own table, as here.
- How long to keep request/response bodies (they hold caller PII).
- Whether "5 failures in a row" should alert the firm, not only staff.

## Layout

```
src/server.ts      routes: /admin (console), /v1 (firm REST-hook API), /receiver (fakes)
src/dispatcher.ts  delivery loop, attempt records, disable rules, resend
src/policy.ts      response classification, retry schedule, Retry-After
src/signing.ts     Standard Webhooks sign / verify
src/template.ts    free-form body templates
src/address.ts     address shape and SSRF checks
src/receivers.ts   fake receivers
src/store.ts       in-memory data
src/lead.ts        standard body, sample leads
public/            the operator page (plain HTML, CSS and JS)
```
