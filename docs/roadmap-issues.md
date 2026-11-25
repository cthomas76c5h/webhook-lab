# Lead integrations roadmap: issue drafts

Drafts for the legacy voice system's issue tracker, in its issue layout. Not filed,
and superseded: the call center (`../../call-center-lab`) is now the source of truth,
and delivery is built on it in `../../lead-integrations`. One issue per committed phase;
free-form body templates (variant B) stay in the backlog and get no issue.

Every phase: off by default behind a flag, staging first, a staging test call
after merge for anything on the call path. Owner is a person to be named.

---

## 0. Record the lead integration architecture in an ADR

**Summary**
Write one ADR that fixes who owns what in lead delivery, so the next phases do
not each re-decide it. For engineers and reviewers of phases 1–5.

**Today:** Destinations live in the account config and are chosen per
disposition by the voice agent. A Zapier subscription, a firm API key, a
"connection" or a "recipe" has no agreed home. The legacy lead API already has
CRM adapters and an outbox, and nothing says how that relates to the platform.

**After this change:** An engineer starting phase 1 or 2 reads one ADR and knows
where each concept lives and which states a delivery can be in.

**Where**
- New: `docs/adr/NNNN-lead-integrations.md`

**Approach**
- Ownership statement: lead generation belongs to the voice agent; lead
  delivery belongs to the worker; integration lifecycle belongs to portal-api;
  the client portal is the firm's configuration surface; Zapier is a consumer,
  not the source of truth. The voice-agent contract v1 does not change.
- Decisions approved in review: API key first, OAuth later; subscriptions in
  their own table, not the account config; firm-owned onboarding with an
  operator fallback; free-form templates parked.
- Name five concepts, even where only one instance exists yet: **event**
  (`lead.created`, versioned; today's 17-field `WebhookLead` v1 is its first
  shape), **connection** (an authorised external system, per firm), **recipe**
  (what should happen; one recipe today: "send the lead"), **mapping** (where
  fields go; the standard body today), **delivery** (one attempt history per
  lead and destination).
- Delivery states we can prove: `queued`, `sending`, `accepted` (2xx from the
  receiver), `retrying`, `failed`, `cancelled`. "Processed by the Zap" and
  "in the CRM" are not observable and the UI never claims them.
- Idempotency: one delivery per `(lead_id, destination_id)`; every attempt
  kept; a resend is a new attempt on the same key, sent with the same
  `webhook-id`.
- Open: how platform delivery relates to the legacy lead API's adapters (reuse, call into,
  or replace). Decide before any direct CRM connector work (phase 5).

**Done when**
- [ ] ADR merged with the five concepts, the states and the idempotency key
- [ ] The relationship with the legacy lead API is recorded as decided or as an open question with an owner
- [ ] Phases 1–5 issues link to it

---

## 1. Show operators every lead delivery attempt and let them resend safely

**Summary**
Make Webhook (Zapier) and Slack delivery trustworthy before adding any new way
to connect. For operators and support.

**Today:** An operator sees one "Last sent" line per Webhook Destination and a
Slack alert on failure. When a firm deletes its Zap, every later lead fails with
HTTP 410, alerts again, and the Destination stays on. There is no record of what
was sent, no Resend, and the worker ignores `Retry-After`.

**After this change:** On the account's Messaging page an operator opens a
Destination's delivery log, sees each lead with its tries, response code and a
plain next action, and resends one. A deleted Zap switches its Destination off
with the reason shown. The UI says "Accepted by Zapier", never "delivered to
CRM".

**Where**
- The configuration's retryable-status rule: add 425; honour `Retry-After`
- The worker's destination delivery: 410 → switch off; a `webhook-id` header
- The admin destinations editor: delivery log, Resend, URL check, sample built from the firm's call types
- Prototype: a Zapier prototype branch (variants A and C); this lab for the rules

**Approach**
- Worker: on 410, mark the Destination switched off with a reason and stop
  sending; honour `Retry-After` within the job's backoff; send `webhook-id:
  <lead_id>` and `webhook-timestamp`. Signing can follow in its own change.
- Resend: a staff action that re-queues one `(lead_id, destination_id)` and
  keeps the earlier attempts. Warn that the CRM may create a second record
  unless the Zap dedupes on `lead_id`.
- Admin UI: rewrite (do not merge) the prototype's log and guided setup.
- Decide how long request and response bodies are kept; they hold caller data.

**Done when**
- [ ] A 410 switches the Destination off, shows why, and raises one alert, not one per lead
- [ ] A 429 with `Retry-After` waits at least that long before the next try
- [ ] Each lead's tries, codes and next action show on the Messaging page
- [ ] Resend works on a failed lead, keeps the old attempts, and is logged with who did it
- [ ] Staging: a Catch Hook Zap receives a call's lead; deleting the Zap switches the Destination off on the next call
- [ ] Rollback: the flag off restores today's behaviour; no data migration to undo

---

## 2. Add firm API keys and lead subscriptions behind one delivery pipeline

**Summary**
The foundation a Zapier app (and later direct connectors) plugs into: scoped,
revocable firm keys and REST-hook subscriptions, delivered by the same worker
pipeline as Destinations. For engineers; firms see nothing yet.

**Today:** The only API key is the voice agent's internal `x-api-key`. A firm
cannot be authenticated, and a webhook can only be added by staff editing the
account config.

**After this change:** Staff create a key scoped to "Zapier lead subscriptions"
for a firm. A client of portal-api with that key can subscribe a hook URL,
unsubscribe it, and fetch sample leads. Each lead goes to the account's active
subscriptions as well as its Destinations, through one sender with one log.

**Where**
- New tables (additive migrations): `account_api_keys` (hash, prefix, scopes,
  environment, created_by, last_used_at, revoked_at) and `lead_subscriptions`
  (account, connection, target URL, status, disabled reason, created/removed)
- New portal API routes: `GET /v1/me`, `POST /v1/hooks`, `DELETE /v1/hooks/:id`, `GET /v1/samples/lead.created`
- The worker's destination delivery: a resolver that merges Destinations and subscriptions into one target list

**Approach**
- Keys: shown once, stored hashed, scoped (`zapier:subscribe` only; a valid key
  does not unlock any other webhook delivery), separate keys per environment.
- Subscribe: per-account authorisation; https only; the same address rules as
  `postToHook` (no private networks, no redirects); unique ids; unsubscribe is
  idempotent (a second DELETE answers 200 or 404, never an error that makes
  Zapier retry forever).
- Revoking a key switches off the subscriptions created with it, with that reason.
- Samples: complete, built from the firm's own call types; never a real caller.
- Delivery: one key per `(lead_id, target_id)` for both kinds; same retries,
  alerts, log and Resend as phase 1. No second retry or monitoring path.
- Spec: this lab's `/v1` routes.

**Done when**
- [ ] A key with the wrong scope or a revoked key gets 401/403 on every `/v1` route
- [ ] Subscribe refuses http, private addresses and other accounts' ids
- [ ] Unsubscribe twice is safe; revoke switches the key's subscriptions off
- [ ] A lead reaches both a Destination and a subscription, with one log for both
- [ ] Staging: subscribe a test hook with curl, place a test call, see the lead and its log
- [ ] Rollback: the flag off stops subscription delivery; the tables stay and are ignored

---

## 3. Ship a private Zapier app and pilot it with one firm

**Summary**
A "New Lead" trigger in an invite-only Zapier integration, so a firm connects
without copying a URL. For one pilot firm, then a second.

**Today:** The firm copies a Catch Hook URL into an email, staff paste it, and
the test lead must arrive while the firm's Zap editor is open.

**After this change:** The firm adds the Answering AI trigger in Zapier, pastes
its key once, clicks Test and sees a complete sample lead, then turns the Zap
on. Turning it off or deleting it removes the subscription.

**Where**
- New repo (for example `answering-ai-zapier`), built with Zapier's Platform
  CLI; calls only the phase 2 `/v1` routes

**Approach**
- API-key auth; one REST-hook trigger (`performSubscribe` with
  `bundle.targetUrl`, `performUnsubscribe` with `bundle.subscribeData`,
  `performList` from `/v1/samples`); labelled output fields.
- Freeze the auth field keys before the pilot; changing them later breaks
  existing connections. Write an integration-version upgrade policy.
- App tests run in that repo's CI against staging.
- Separate staging and production app versions or credentials.

**Done when**
- [ ] Invite-only app published; its tests pass in CI
- [ ] Staging: connect, Test, turn on, place a call, lead arrives; turn off, subscription is gone
- [ ] One real firm runs it for two weeks with no staff intervention
- [ ] Rollback: the firm switches back to its Catch Hook Zap; revoking the key stops delivery

---

## 4. Let firms connect Zapier from the client portal

**Summary**
A self-service Integrations page so firms connect and watch their integration
without staff. Starts only after the phase 3 pilot succeeds.

**Today:** Only staff can see or change where a firm's leads go.

**After this change:** A firm admin opens Integrations, creates its key, opens
the Zapier app from a "Connect" button, and sees one status per connection.

**Where**
- The client portal: new Integrations page
- The portal API: key management and connection status for Client Users

**Approach**
- Statuses we can prove: **Connected** (subscription active), **Waiting for
  first lead** (active, nothing accepted yet), **Delivering** (at least one
  lead accepted), **Needs attention** (switched off, or repeated failures).
  A sample request during Zap setup is not proof the Zap is on.
- Plain message and a Reconnect step when a Zap goes away.
- Key create/revoke for firm admins only.

**Done when**
- [ ] A firm admin connects Zapier with no staff help on staging
- [ ] Each status appears from real evidence, never from a checkbox
- [ ] Staff see the same status in admin-ui
- [ ] Rollback: the page hidden behind its flag; keys and subscriptions keep working

---

## 5. Decide how firms reach CRMs beyond Zapier

**Summary**
An evaluation, not a build: choose how direct CRM connections and a public
Zapier listing should work before writing connectors. For product and engineering.

**Today:** Zapier covers any CRM but adds a step the firm maintains. The legacy lead
API already has adapters for Clio Grow, Lead Docket, Law Ruler and
Lawmatics, with an outbox and retries, outside this platform.

**After this change:** A written decision with evidence: reuse the legacy lead API's
adapters, build connectors here, or adopt an embedded integration platform
(Merge, Prismatic); and whether to list the Zapier app publicly (and add OAuth
or ready-made Zaps).

**Where**
- New: a decision record in `docs/adr/`

**Approach**
- Test each option against two or three real workflows (for example Clio Grow
  "create lead", Lawmatics "create contact + matter"): custom fields, write
  operations, onboarding UI, tenant isolation, cost.
- Measure what matters: human minutes to onboard a firm, share of firms that
  connect without staff, time to first accepted lead, failures per 1,000 leads.

**Done when**
- [ ] Decision record with the comparison and the chosen path
- [ ] A follow-up issue per chosen connector or listing step

---

## Suggested board fields (for a person to set)

| # | Severity | Area | Effort |
|---|---|---|---|
| 0 | P2 | Lead delivery | S |
| 1 | P1 | Lead delivery / admin-ui | M |
| 2 | P2 | portal-api / worker | L |
| 3 | P2 | Integrations | M |
| 4 | P2 | Client portal | M |
| 5 | P2 | Integrations | S |
