// Free-form JSON body templates, in the syntax of the platform's message
// template editor: {{field}} and {{field|default:'text'}}. Values are
// JSON-escaped, so a placeholder always sits inside a JSON string.

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*default:'([^']*)')?\s*\}\}/g;

export interface RenderResult {
  ok: boolean;
  body: string;
  errors: string[];
  used: string[];
}

// Intake answers differ per call type and are missing on a hang-up, so an
// unknown `intake.*` field renders empty. Any other unknown field is a typo.
const OPTIONAL_PREFIX = 'intake.';

export function renderTemplate(template: string, vars: Record<string, unknown>): RenderResult {
  const errors: string[] = [];
  const used = new Set<string>();
  const text = template.replace(PLACEHOLDER, (_m, name: string, fallback?: string) => {
    if (!(name in vars) && name.startsWith(OPTIONAL_PREFIX)) return fallback ?? '';
    if (!(name in vars)) {
      errors.push(`unknown field {{${name}}}`);
      return '';
    }
    used.add(name);
    const raw = vars[name] == null ? '' : String(vars[name]);
    const value = raw === '' && fallback !== undefined ? fallback : raw;
    return JSON.stringify(value).slice(1, -1);
  });
  let body = text;
  try {
    // Re-serialise: the receiver always gets compact, valid JSON.
    body = JSON.stringify(JSON.parse(text));
  } catch (e) {
    errors.push(`not valid JSON: ${(e as Error).message}`);
  }
  return { ok: errors.length === 0, body, errors, used: [...used] };
}

/** Flatten `{ intake: { a: 1 } }` to `{ 'intake.a': 1 }` so templates can reach nested answers. */
export function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}
