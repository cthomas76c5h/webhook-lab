# webhook-lab (CLAUDE.md)

Throwaway prototype for lead delivery to webhooks. In-memory; no dependencies;
Node runs the `.ts` files directly (type stripping), so use only erasable
TypeScript (no enums, no parameter properties, no namespaces) and import with
the `.ts` extension.

- Run: `npm start` · Watch: `npm run dev` · Tests: `npm test`
- This project's Baseline target is Baseline 2025. Features newer than that
  ship only as progressive enhancement or with a conditionally loaded fallback.
- Web guidance: `npx modern-web-guidance@latest search "<topic>"`, then
  `retrieve "<id>"`, before adding UI behavior.
- **Superseded** by `../../lead-integrations`, which is built on the call center
  (`../../call-center-lab`) as the source of truth. Keep it as history; build there.
- **Docs are generic.** Never name legacy internal systems or repositories, their file
  paths or branches; say "the legacy voice system", "the legacy lead API" and describe
  the behaviour.
- User-facing strings say "Answering AI"; never name voice or telephony vendors.
- Never commit or push unless asked.
