# Bangin Bustos Tamales

The web app for Bangin Bustos Tamales: a public site, order forms, a Live POS, and an Admin area.
The site is at `bustostamales.com`.

| Part | Technology | Folder |
| --- | --- | --- |
| Site | React, Vite, TypeScript, on Firebase Hosting | `src/` |
| Data and owner login | Firestore and Firebase Auth (free Spark plan) | `firebase/` |
| API and email | 1 Cloudflare Worker, Resend, Turnstile | `worker/` |
| Admin scripts | Node scripts that use the Firebase Admin SDK | `scripts/` |

## Documents

- [docs/V1_FUNDAMENTALS.md](docs/V1_FUNDAMENTALS.md): what the app does.
- [docs/V1_DESIGN.md](docs/V1_DESIGN.md): visual design and the content standard.
- [DEPLOYMENT.md](DEPLOYMENT.md): deploy, first-time setup, variables and secrets.
- [ADMIN_SETUP.md](ADMIN_SETUP.md): how to give a person owner access.
- [AGENT_changelog.md](AGENT_changelog.md) and [USER_changelog.md](USER_changelog.md): what changed.
- [CLAUDE.md](CLAUDE.md): rules for agents.

`ARCHITECTURE.md`, `HANDOFF.md`, `SECURITY.md` and `BanginBustosTamalesPlan.md` are history only.

## Commands

| Command | Function |
| --- | --- |
| `npm install` | Installs the site dependencies. |
| `npm run dev` | Starts the site at `http://127.0.0.1:5173`. |
| `npm run build` | Checks types and builds the site to `dist/`. |
| `npm test` | Runs the site tests. |
| `npm --prefix worker install` | Installs the Worker dependencies. |
| `npm run worker:dev` | Starts the Worker at `http://127.0.0.1:8787`. |
| `npm run worker:test` | Runs the Worker tests. |

Copy `.dev.vars.example` to `.env.local` and `worker/.dev.vars.example` to `worker/.dev.vars`, then add your values.
A push to `main` deploys to production.
