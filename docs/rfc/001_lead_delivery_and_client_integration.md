# RFC-001: Lead Delivery & Client Integration Management

**Answering AI — Product and Technical Proposal**

**Date:** November 18, 2026  
**Status:** Proposed — Awaiting stakeholder approval  
**Decision owner:** Product / Engineering Leadership  
**Reviewers:** Operations, Engineering, Customer Success, Security, Management

---

## 1. Executive Summary

Answering AI receives calls, collects lead information, and delivers that information to law firms through email, SMS, Zapier, webhooks, and other integrations.

Our existing approach works, but onboarding and supporting integrations requires manual coordination between operators, law firms, and sometimes engineers.

As we add more clients, we repeatedly encounter the same problems: different CRM systems, different field requirements, different routing rules, broken connections, and limited visibility into delivery failures.

**We propose improving the existing delivery system and introducing a shared integration management workflow.**

Operators will continue guiding law firms through onboarding. The new tools will make their work more consistent, allow them to resolve common problems without engineering support, and give clients visibility into the configuration they are approving.

We will build this incrementally on our existing infrastructure, preserving current integrations and the voice-agent API contract.

### Recommended decision

Approve the development of an **operator-assisted integration management MVP**, consisting of:

1. Reliable lead delivery and an operator-facing Delivery Center.
2. Reusable integration configurations and onboarding records.
3. A client review, change-request, and approval workflow.
4. Versioned configurations with controlled activation and rollback.
5. A private Zapier integration to reduce manual webhook setup.

Direct CRM integrations, advanced workflow builders, and fully self-service onboarding are outside the initial scope.

---

## 2. Problem Statement

### Current process

Our V1 Zapier prototype asks the law firm to:

1. Create a Zap using Webhooks by Zapier.
2. Copy a Catch Hook URL.
3. Send that URL to our operator.
4. Coordinate a sample lead.
5. Configure the destination CRM action.
6. Map lead fields to CRM fields.
7. Test and activate the Zap.

This is a practical prototype, but it exposes technical work to the customer and creates manual handoffs.

When integrations stop working, the operator must determine whether the issue is with Answering AI, the receiving webhook, Zapier, the CRM, or the firm's configuration.

### Recurring problems

| Problem | Impact |
|---|---|
| Manual onboarding | Every new firm requires repeated coordination |
| Different CRM requirements | Operators repeat similar mapping and setup tasks |
| Limited client visibility | Firms cannot easily review what was configured |
| Unclear ownership | It is not always clear who must resolve a failure |
| Difficult troubleshooting | Operators may depend on engineering |
| Uncontrolled configuration changes | Live behavior can change without clear approval history |
| Limited downstream verification | Webhook acceptance does not guarantee CRM delivery |

### Business impact

Without a repeatable process, support work grows alongside the number and complexity of customer integrations.

Our goal is to reduce that operational burden while preserving the operator-assisted experience clients prefer.

---

## 3. Product Vision

**Build integrations once, configure them for each firm, and operate them by exception.**

The product will have two primary user experiences.

### Operator Console

Operators need to:

- Create and manage integration setups.
- Apply standard configurations and reusable recipes.
- Guide clients through authentication and testing.
- Review delivery results.
- Diagnose and resolve common errors.
- Propose configuration changes.
- Activate approved revisions.
- Pause or resend deliveries when authorized.

### Client Portal

Law firms need to:

- See which systems receive their leads.
- Understand what information is shared.
- Review routing rules and field mappings.
- Authorize connections to their software.
- Approve proposed configurations.
- Request changes or provide feedback.
- View integration health and approval history.

The client portal does not initially need to be a full integration editor.

**The operator manages the technical setup. The client approves the intended business behavior.**

---

## 4. Proposed Onboarding Workflow

A single onboarding record should track the entire integration setup.

### Step 1 — Operator prepares the setup

The operator selects the firm, destination type, and standard recipe.

The system provides recommended fields and settings. Operators can make adjustments without changing application code.

**Result:** A draft configuration.

### Step 2 — Client authorizes the connection

The client connects the CRM or Zapier account through the supported authentication method.

Operators guide the process but should not collect or handle customer passwords.

**Result:** An authorized connection or documented external setup.

### Step 3 — Operator sends the configuration for review

The portal displays a business-readable summary:

- Which events trigger delivery.
- Which destination receives them.
- What caller information is shared.
- What routing or filtering rules apply.
- Whether existing records may be updated.
- Which notifications remain active.

**Result:** A configuration awaiting client approval.

### Step 4 — Client approves or requests changes

The client may approve the proposal or request revisions.

A change request returns the configuration to the operator, including the client's feedback.

**Result:** An approved configuration revision.

### Step 5 — Test the integration

The system generates a representative test lead and delivers it to the receiver.

For webhook integrations, the system records whether the receiver accepted it.

For Zapier-based integrations, the firm or operator must separately confirm the downstream CRM result unless additional verification is available.

**Result:** A recorded test outcome.

### Step 6 — Activate

Once approval and the required test checks are complete, an authorized operator activates the configuration.

Only then does it begin receiving production leads.

**Result:** An active, versioned integration with delivery monitoring enabled.

### Proposed onboarding states

`Connection Needed → Draft → Awaiting Approval → Ready to Test → Testing → Test Accepted → Ready to Go Live → Live`

| State | Meaning | Next action |
|---|---|---|
| Connection Needed | The draft configuration exists (Step 1), but the client has not connected yet. The operator can still edit it. | Send the client the secure link |
| Draft | Connected; this revision has not been sent for approval. | Send for approval |
| Awaiting Approval | The client has been asked to approve this revision. | Follow up |
| Changes Requested | The client asked for changes to this revision. | Edit, which creates a new revision, then resend |
| Ready to Test | The client approved this revision. | Send a test lead |
| Testing | The test lead is in flight. | Wait |
| Test Failed | The receiver refused or did not accept the test lead. | Fix the mapping or the external setup, then retest |
| Test Accepted | The receiver accepted the test lead. | Client confirms the record in the CRM |
| Ready to Go Live | Approved, tested, and confirmed by the client. | Activate |
| Live | Production leads use this revision. | Monitor in the Delivery Center |

Any edit creates a new revision and returns the setup to Draft. Approvals and test results apply to a single revision and do not carry over to the next one.

After go-live, the same states apply to a draft revision, and the installation stays Live on its active revision until the draft is activated (see Section 5). Canceled setups are retained in audit history.

Delivery health is tracked separately from onboarding status.

---

## 5. Change-Request and Revision Workflow

This is a core requirement, not an optional enhancement.

After an integration is live, firms may ask to change how their leads are handled.

Examples:

- Send personal injury calls to a different destination.
- Include an additional intake field.
- Stop forwarding specific information.
- Change which attorney receives notifications.
- Add a new CRM.
- Change how existing callers are handled.

We need to support these requests without modifying active configurations unexpectedly.

### Recommended workflow

**Request → Draft Revision → Review → Approval → Test → Activate**

#### A. Client submits a request

The client selects **Request changes** from the integration page.

They describe the desired result in ordinary language.

Example:

"Please send family-law inquiries to our family-law intake workflow instead of the general intake workflow."

The system creates a change request linked to the active integration.

#### B. Operator prepares a revision

The operator opens the request, copies the active configuration into a draft revision, and makes the proposed changes.

The live configuration remains unchanged.

#### C. System generates a change summary

The portal displays a comparison between the active configuration and the proposed revision.

Example:

| Setting | Current | Proposed |
|---|---|---|
| Call type | All inquiries | Family law only |
| Destination | General Intake | Family Law Intake |
| Caller details | Name, phone, summary | Unchanged |
| Activation | Live | Awaiting approval |

The client should not have to compare raw JSON or API payloads.

#### D. Client approves or requests another revision

Approval applies to a specific immutable revision.

If the operator changes that revision afterward, the prior approval does not automatically apply to the modified version.

The system records who approved it, when, and the exact revision approved.

#### E. Operator tests and activates

The new revision is tested before activation.

If a required test fails, the current production configuration remains active unless the existing configuration itself poses a safety or security risk.

Activation switches the installation to the approved revision.

The previous revision remains available for audit and possible rollback.

---

## 6. Approval Policy

Not every technical change should require the client to approve another configuration.

We recommend a risk-based policy.

| Change | Client approval | Operator action |
|---|---|---|
| Change lead destination | Required | Draft, test, activate |
| Add or remove shared caller fields | Required | Draft, test, activate |
| Change call-type routing | Required | Draft, test, activate |
| Change CRM record creation/update behavior | Required | Draft, test, activate |
| Update webhook retry timing | Not normally required | Authorized technical change |
| Repair formatting without changing approved meaning | Not normally required | Authorized repair and test |
| Resend a failed lead | Not normally required | Authorized resend |
| Pause a failing or compromised destination | May be done immediately | Notify affected parties |
| Reconnect expired credentials | No new business approval if behavior is unchanged | Client authorizes credentials |
| Roll back to an earlier revision | Depends on whether it is still approved and authorized | Verify and record rollback |

### Approval rules

1. Business behavior changes require approval from an authorized firm representative.
2. Approval applies to an immutable configuration revision, not an entire integration indefinitely.
3. Only authorized operators may activate a revision.
4. Technical repairs must be logged, with the original and resulting behavior recorded.
5. Urgent pauses are permitted without prior client approval to prevent continued failures or inappropriate data delivery.
6. An urgent pause must not silently reroute caller information to another destination.
7. A resend must preserve the original delivery identity and create a separate attempt record.
8. A prior revision cannot be restored automatically if its credentials, authorization, or approved business behavior are no longer valid.

### Approval evidence

Store:

- Integration ID and revision ID.
- Firm account ID.
- Approver identity and authorization role.
- Approval timestamp.
- Exact approved configuration snapshot or hash.
- Approval status.
- Relevant test results.
- Activation actor and timestamp.
- Change-request history and comments.

These records should be append-only and protected from ordinary editing.

---

## 7. Delivery Center and Exception Handling

The Delivery Center is the operator's primary daily workspace.

The system should handle normal deliveries automatically. Operators should focus on cases requiring a decision or corrective action.

### Expected workflow

**Spot → Diagnose → Fix → Resend → Verify**

The operator sees an actionable error and a recommended next step.

| Failure | Default behavior |
|---|---|
| Temporary network failure | Automatic retry |
| Receiver rate limit | Honor supported retry instructions |
| Missing required mapped field | Operator reviews mapping and source data |
| Deleted webhook / HTTP 410 | Disable destination and request reconnection |
| Repeated permanent failures | Pause after configured threshold and alert |
| Revoked credentials | Request reconnection |
| Possible duplicate delivery | Preserve identity and inspect attempt history |
| Unknown error | Escalate with diagnostic information |

The system should distinguish between:

- **Accepted by receiver:** The webhook or API acknowledged receipt.
- **Processed by integration:** The intermediate integration ran successfully, when observable.
- **Verified in CRM:** The destination record was confirmed through a supported API or human verification.

Do not label a lead "Delivered to CRM" merely because Zapier returned an HTTP success response.

Tests and production deliveries must also be reported separately so dashboard metrics remain consistent.

### Operator permissions

Standard operators may inspect logs, initiate supported tests, prepare changes, and perform approved routine recovery actions.

More sensitive actions—such as overriding approval requirements, changing credentials, or performing exceptional rerouting—require elevated permission or escalation.

All operational actions must be recorded.

---

## 8. Technical Architecture

### Architectural approach

Extend the existing application rather than creating an independent integration platform immediately.

**Existing repositories:**

- `vapi-receptionist`: portal API, database migrations, worker, delivery logic, operator UI.
- `airi-client-portal`: client integration review, authorization, and approval screens.
- New small `answering-ai-zapier` repository: private Zapier application definition.

The existing voice-agent API remains unchanged:

- `GET /api/dids/:phoneNumber`
- `POST /api/leads/deliver`

The internal voice-agent API key must remain separate from firm-facing integration credentials.

### Recommended technologies

| Concern | Choice |
|---|---|
| Frontend | Existing React / Next.js and TypeScript |
| Backend | Existing portal API |
| Persistent storage | PostgreSQL |
| Delivery execution | Existing worker and durable job infrastructure |
| Validation | Zod / JSON Schema |
| Zapier | Zapier Platform CLI |
| Monitoring | Existing logs and metrics, with structured delivery tracing |
| Authentication | Existing client/employee authentication plus scoped firm API keys |
| Approval history | Immutable revision and audit records |

Introduce new infrastructure only when the existing stack cannot meet measured requirements.

### Core data concepts

**Connection:** Credentials or authorization linking a firm to an external system.

**Subscription:** A receiver registered to receive specific events.

**Recipe:** A reusable definition of a supported integration behavior.

**Installation:** A firm's configured use of a recipe and connection.

**Revision:** An immutable snapshot of a proposed or active configuration.

**Change request:** A client- or operator-initiated request to modify an installation.

**Approval:** Authorization for a specific revision.

**Delivery:** One lead being sent to one destination.

**Delivery attempt:** An individual HTTP/API attempt against that delivery.

**Outbox event:** A durable record of work that needs delivery.

These should have account-scoped access controls and appropriate foreign-key relationships.

### Delivery requirements

The worker should:

1. Persist lead information before attempting external delivery.
2. Use a durable outbox or existing equivalent.
3. Resolve active destinations and applicable configuration revisions.
4. Record each destination delivery.
5. Retry transient failures with bounded exponential backoff.
6. Honor supported `Retry-After` values.
7. Record structured attempt results.
8. Stop delivery to disabled destinations.
9. Support safe operator resend and diagnostic inspection.

Use stable delivery identifiers and database uniqueness controls to prevent accidental internal duplication.

Do not promise exactly-once CRM creation unless the downstream system supports compatible idempotency.

### Security and privacy

Production implementation must include:

- Authenticated operator and client access.
- Role-based authorization and tenant isolation.
- Encrypted integration credentials.
- Safe callback URL validation and SSRF protections.
- Protected approval and audit history.
- Caller-data minimization in logs and samples.
- Defined request/response retention periods.
- Secure, expiring client review links where applicable.
- Staging verification before production rollout.

The prototype's identified security gaps must not be carried into production.

---

## 9. Scope and Rollout

### Phase 1 — Delivery Reliability and Operator Visibility

**Goal:** Make existing webhook integrations reliable and supportable.

Deliver:

- Delivery logs and actionable error messages.
- Automatic retry and disabled-destination handling.
- Operator resend and pause controls.
- Consistent reporting.
- Real authentication, authorization, and persistence.

Existing integrations remain active.

### Phase 2 — Assisted Onboarding and Configuration Revisions

**Goal:** Let operators manage a repeatable onboarding process.

Deliver:

- Onboarding queue.
- Shared integration setup records.
- Reusable initial configurations.
- Client review and change-request screens.
- Immutable revisions and approval history.
- Controlled testing and activation.

### Phase 3 — Native Zapier Integration

**Goal:** Reduce manual Catch Hook setup.

Deliver:

- Firm-scoped API keys.
- Lead subscriptions.
- Private Zapier app.
- New Lead trigger.
- Sample lead endpoint.
- Production pilot with selected firms.

Existing Catch Hook Zaps remain supported during migration.

### Phase 4 — Client Visibility and Expanded Automation

**Goal:** Make integrations easier to maintain.

Deliver:

- Integration status and health in the client portal.
- Client-initiated change requests.
- Improved reconnection flows.
- Additional standard recipes.
- Selective direct CRM integrations based on demand.

### Explicitly out of scope for the MVP

- Building a general-purpose workflow automation platform.
- Supporting every legal CRM directly.
- Full graphical workflow editing.
- Automatic editing of mappings inside customer-owned Zapier Zaps.
- OAuth for the initial private Zapier integration.
- Guaranteed visibility into every downstream CRM.
- Replacing existing working integrations as a prerequisite.

---

## 10. Success Criteria

Before implementation, collect a baseline for existing operator-assisted onboarding.

The initial pilot should measure:

| Metric | Proposed pilot target |
|---|---|
| Routine setup requiring engineering | Zero for supported integration configurations |
| Successful operator-led onboarding | At least 90% without engineering escalation |
| Client review and approval | Every material business configuration approved |
| Delivery history | All attempts recorded and traceable |
| Failure recovery | Operator can diagnose supported common errors |
| Time to first working delivery | Measured against V1 baseline |
| Production regressions | No unexplained loss of existing lead deliveries |

These are proposed targets, not current performance measurements.

Evaluate the pilot using real client scenarios and at least one production integration after staging validation.

---

## 11. Key Risks and Mitigations

**Scope expansion:** The initiative could grow into a general integration platform.

*Mitigation:* Focus on the operator's workflows, the current lead-delivery contract, and the most common customer destinations.

**Approval complexity:** Requiring approval for every small change could slow down support.

*Mitigation:* Apply risk-based approval rules and distinguish technical repairs from business behavior changes.

**False delivery confidence:** Zapier webhook acceptance may not prove CRM record creation.

*Mitigation:* Report observed delivery stages accurately and require client confirmation where automated verification is unavailable.

**Data privacy:** Caller information may appear in payloads, logs, and sample data.

*Mitigation:* Define access, minimization, encryption, and retention before production.

**Migration risk:** Existing integrations may be disrupted by changes to routing or subscriptions.

*Mitigation:* Additive database migrations, feature flags, staging tests, and gradual rollout.

**Uncontrolled configuration drift:** A client may edit a Zap independently after approving the intended behavior in our portal.

*Mitigation:* Identify externally managed settings as unverified, record the scope of approval, and avoid promising continuous enforcement of Zapier mappings.

---

## 12. Decisions and Approval Request

The following decisions are recommended for approval.

| # | Decision | Proposed resolution |
|---|---|---|
| D1 | Primary onboarding model | Operator-assisted first |
| D2 | Client responsibilities | Authorization, business review, approval, and change requests |
| D3 | Operator responsibilities | Configuration, testing, activation, and routine troubleshooting |
| D4 | Configuration ownership | Centralized, versioned integration records |
| D5 | Post-launch changes | Risk-based approval; no silent business behavior changes |
| D6 | Delivery architecture | Reuse and strengthen existing worker, database, and queue |
| D7 | Zapier approach | Private app with scoped API keys; OAuth deferred |
| D8 | Initial product scope | Delivery Center, assisted onboarding, client review, and controlled revisions |
| D9 | Existing integrations | Preserve compatibility during migration |
| D10 | Direct CRM connectors | Defer until justified by customer demand |

### Approval requested

Stakeholders are asked to approve:

1. The product direction and operator-assisted workflow.
2. The responsibilities assigned to operators, clients, and the platform.
3. The configuration revision and approval policy.
4. The MVP scope and phased implementation approach.
5. The use of the existing application stack as the starting architecture.

Approval of this RFC authorizes detailed technical design and backlog planning. It does **not** authorize deploying the existing prototype to production without the required security, persistence, testing, and operational controls.

### Items requiring specialist sign-off before production

- **Security:** Credential storage, secure links, authorization, webhook destination restrictions.
- **Privacy/compliance:** Caller-data retention and access policy.
- **Engineering:** Durable outbox design, failure thresholds, retry rules, migration plan.
- **Operations:** Operator permissions, escalation procedures, onboarding ownership.
- **Product:** Pilot firms, acceptance criteria, and rollout sequencing.

These should be resolved by the named responsible reviewers asynchronously and incorporated into the implementation specification.

---

## 13. Proposed Next Steps

Once the RFC is approved:

1. Convert the agreed workflows into acceptance-tested engineering issues.
2. Produce a database and API design for integration installations, revisions, and approvals.
3. Validate the proposed operator and client screens with representative onboarding cases.
4. Implement the delivery reliability work before enabling new subscription paths.
5. Pilot assisted onboarding and measure its impact.
6. Review pilot results before expanding into direct CRM integrations.

---

## Final Recommendation

**Proceed with an operator-assisted integration management product, not a fully self-service integration marketplace.**

Use existing infrastructure wherever possible. Standardize the lead data and delivery process, centralize configuration and approval history, and give operators tools to manage the exceptions.

The product should make a new firm easier to onboard, a failed delivery easier to diagnose, and an integration change easier for the client to understand and approve.

**Guiding principle: Build once, configure many times, approve changes explicitly, and operate by exception.**
