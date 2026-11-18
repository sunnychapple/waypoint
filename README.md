# Waypoint

Lecture capture and study app. Local first on the iPhone; Cloudflare holds locked copies for sync and sharing and runs the cloud tasks a person pays credits for.

- `docs/architecture.md`: the system as designed.
- `docs/build-plan.md`: the pull requests that build it, in order.
- `AGENTS.md`: rules for every change.

## Layout

| Path | What |
|---|---|
| `packages/*` | Shared TypeScript packages, no build step |
| `apps/api` | The API Worker on Cloudflare |
| `apps/mobile` | React Native host app and feature bundles |
| `apps/viewer` | Shared-link web viewer |
| `db/d1` | D1 schema and migrations |

## Commands

```sh
npm install
npm run typecheck
npm test
```
