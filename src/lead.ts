// Lead bodies. `standardBody` is the same field set the platform's
// buildWebhookLead sends today (contract: never rename, remove or retype a
// field), plus the event envelope fields a receiver needs to dedupe.

import type { LeadEvent } from './store.ts';

export interface Lead {
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string;
  call_type: string;
  message: string;
  details: string;
  transcript: string;
  recording_link: string;
  recording_link_expires_at: string;
  call_link: string;
  called_at: string;
  number_called: string;
  source: string;
  intake: Record<string, string>;
}

export function standardBody(event: LeadEvent): Record<string, unknown> {
  const { intake: _intake, ...lead } = event.data as unknown as Lead;
  return {
    schema_version: 1,
    event: event.type,
    event_id: event.id,
    lead_id: event.id,
    ...lead,
  };
}

/** Everything a template may use: the standard fields, `intake.*`, and `firm_name`. */
export function templateVars(event: LeadEvent, firmName: string): Record<string, unknown> {
  const data = event.data as unknown as Lead;
  const vars: Record<string, unknown> = { ...standardBody(event), firm_name: firmName };
  for (const [k, v] of Object.entries(data.intake ?? {})) vars[`intake.${k}`] = v;
  return vars;
}

const CALLERS: { first: string; last: string; type: string; intake: Record<string, string> }[] = [
  { first: 'Jane', last: 'Doe', type: 'Personal Injury', intake: { incident_date: '2026-11-12', injuries: 'Neck pain', at_fault_party: 'Other driver' } },
  { first: 'Marcus', last: 'Reed', type: 'Workers Comp', intake: { employer: 'Acme Freight', injury_date: '2026-11-03', reported_to_employer: 'Yes' } },
  { first: 'Ana', last: 'Silva', type: 'Family Law', intake: { matter: 'Custody modification', children: '2', county: 'Nassau' } },
];

export function sampleLead(firmName: string, variant: 'full' | 'sparse' | number = 'full'): Lead {
  const now = new Date();
  if (variant === 'sparse') {
    // What a hang-up after the greeting looks like: most fields empty.
    return {
      first_name: 'Unknown', last_name: 'Caller', full_name: '', phone: '+15555550199', email: '',
      call_type: '', message: 'Call from +15555550199 about an unclassified call', details: '',
      transcript: `Receptionist: Thank you for calling ${firmName}, how may I help?\nCaller: …`,
      recording_link: '', recording_link_expires_at: '', call_link: 'https://portal.example.com/calls/sample',
      called_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), number_called: '+15555551234',
      source: 'Answering AI', intake: {},
    };
  }
  const c = CALLERS[typeof variant === 'number' ? variant % CALLERS.length : 0]!;
  const details = Object.entries(c.intake)
    .map(([k, v]) => `${k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}: ${v}`)
    .join('\n');
  const expires = new Date(now.getTime() + 7 * 86_400_000);
  return {
    first_name: c.first,
    last_name: c.last,
    full_name: `${c.first} ${c.last}`,
    phone: '+15555550142',
    email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`,
    call_type: c.type,
    message: `${c.first} ${c.last} called about a ${c.type.toLowerCase()} matter and asked for a callback.`,
    details,
    transcript: `Receptionist: Thank you for calling ${firmName}, how may I help?\nCaller: Hi, this is ${c.first}. I need to talk to a lawyer.`,
    recording_link: 'https://recordings.example.com/call.ogg?X-Amz-Expires=604800&X-Amz-Signature=sample',
    recording_link_expires_at: expires.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    call_link: 'https://portal.example.com/calls/sample',
    called_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    number_called: '+15555551234',
    source: 'Answering AI',
    intake: c.intake,
  };
}
