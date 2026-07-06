# WhatsApp Flow

> Open-source WhatsApp automation workspace for building, running, and monitoring bot flows from a visual dashboard.

[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3+-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![TanStack Start](https://img.shields.io/badge/TanStack%20Start-1.x-ff4154?logo=tanstack&logoColor=white)](https://tanstack.com/start)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169e1?logo=postgresql&logoColor=white)](https://orm.drizzle.team/)

WhatsApp Flow gives teams a self-hostable control plane for WhatsApp automation: connect devices, design conversation logic, capture replies, route branches, trigger webhooks, hand off to humans, and inspect runtime activity in one place.

![WhatsApp Flow dashboard flow builder](docs/screenshots/dashboard-flow.png)

## Why This Exists

Most WhatsApp bot setups become a mix of scripts, fragile webhook handlers, and hard-to-debug message state. WhatsApp Flow turns that into a dashboard-driven workflow:

- Build flows visually instead of hard-coding every conversation path.
- Support both simple keyword bots and more advanced branching automations.
- Keep device, inbox, contact, execution log, user, role, and settings management in the same app.
- Self-host the full stack with PostgreSQL and Bun.
- Extend the system through typed packages, tRPC routers, and provider abstractions.

## Highlights

### Visual Flow Builder

- Drag-and-connect node canvas powered by React Flow.
- Trigger nodes for keywords, any incoming message, webhooks, and schedules.
- Message nodes for text, templates, reactions, media, documents, locations, buttons, lists, and quick replies.
- Logic nodes for conditions, delays, variables, wait-for-reply steps, and random routing.
- Action nodes for forwarding, webhook calls, and ending a conversation.
- Live save/deploy controls, flow sessions, and flow-specific logs.

### WhatsApp Operations

- Manage WhatsApp devices and connection status.
- Support Baileys sessions and Meta WhatsApp Cloud API configuration.
- Handle QR/status updates and inbox changes in real time with SSE.
- Store media locally or through S3-compatible storage.
- Trigger automations from messages, schedules, or external webhooks.

### Admin Platform

- Better Auth with local database-backed users.
- Admin bootstrap through `ADMIN_EMAILS`.
- Role-based access controls, audit logs, user management, and settings pages.
- Branding, OAuth/OIDC, SMTP, storage, and Meta settings from the dashboard.
- Metrics endpoint support for production observability.

## Tech Stack

| Area | Stack |
| --- | --- |
| Runtime | Bun |
| Monorepo | Turborepo + Bun workspaces |
| Web | TanStack Start, TanStack Router, Vite, Tailwind CSS |
| API | Hono, tRPC |
| Auth | Better Auth |
| Database | PostgreSQL, Drizzle ORM |
| UI | shadcn/ui primitives in `packages/ui` |
| WhatsApp | Baileys + Meta Cloud API integrations |
| Quality | TypeScript, Biome, Husky |

## Repository Layout

```text
whatsapp-flow/
├── apps/
│   ├── web/             # TanStack Start dashboard
│   └── server/          # Hono API server
├── packages/
│   ├── api/             # Business logic, tRPC routers, flow engine
│   ├── auth/            # Better Auth configuration and provider settings
│   ├── config/          # Shared TypeScript/tooling config
│   ├── db/              # Drizzle schema, migrations, database scripts
│   ├── env/             # Typed environment validation
│   ├── storage/         # Local and S3-compatible storage
│   ├── ui/              # Shared shadcn/ui components and styles
│   └── whatsapp/        # WhatsApp provider integrations
└── package.json
```

## Requirements

- Bun `1.3.13` or newer.
- PostgreSQL.
- Docker or Podman, optional, if you want containerized local services.

## Quick Start

Clone the repository, install dependencies, configure environment files, migrate the database, and start the apps:

```bash
bun install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
bun run db:migrate
bun run dev
```

Open:

- Web dashboard: [http://localhost:3001](http://localhost:3001)
- API server: [http://localhost:3000](http://localhost:3000)

If you need a local PostgreSQL container and Docker is available:

```bash
bun run db:start
bun run db:migrate
```

## Environment

Minimum server configuration:

```bash
# apps/server/.env
BETTER_AUTH_SECRET=replace-with-a-random-secret
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001
DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_flow
ADMIN_EMAILS=admin@example.com
SETTINGS_ENCRYPTION_KEY=replace-with-base64-32-byte-key
PUBLIC_BASE_URL=http://localhost:3000
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=uploads
```

Minimum web configuration:

```bash
# apps/web/.env
VITE_SERVER_URL=http://localhost:3000
```

Generate strong secrets:

```bash
openssl rand -base64 32
```

## Database

This project uses PostgreSQL and Drizzle migrations.

```bash
bun run db:migrate
```

Useful database commands:

```bash
bun run db:start    # start bundled Docker Compose database
bun run db:studio   # open Drizzle Studio
bun run db:push     # push schema changes directly
bun run db:stop     # stop bundled database
```

## Development

Run both apps:

```bash
bun run dev
```

Run one app:

```bash
bun run dev:web
bun run dev:server
```

The development workflow expects:

- Backend on `http://localhost:3000`
- Frontend on `http://localhost:3001`
- `CORS_ORIGIN=http://localhost:3001`
- `VITE_SERVER_URL=http://localhost:3000`

## Manual Run After Build

Build everything:

```bash
bun run build
```

Start the built backend:

```bash
cd apps/server
bun run start
```

Start the built web preview in another terminal:

```bash
cd apps/web
bun run serve --host 0.0.0.0 --port 3001
```

Open [http://localhost:3001](http://localhost:3001).

Build outputs:

- Web app: `apps/web/dist`
- Server app: `apps/server/dist/index.mjs`

## Authentication And Admin Access

Authentication is powered by Better Auth and local database tables.

Set one or more bootstrap admins before first login:

```bash
ADMIN_EMAILS=admin@example.com,owner@example.com
```

After signing in as an admin, use `Dashboard > Settings` to configure:

- Branding and support details.
- OAuth/OIDC providers.
- Meta WhatsApp Cloud API values.
- Storage and application settings.

OAuth callback paths:

```text
/api/auth/callback/google
/api/auth/callback/github
/api/auth/oauth2/callback/{providerId}
```

Register callbacks with the full backend origin, for example:

```text
http://localhost:3000/api/auth/oauth2/callback/oidc-acme-sso
```

## Meta WhatsApp Cloud API

For Meta Cloud API devices, configure:

```bash
# apps/server/.env
META_GRAPH_API_VERSION=v23.0
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_APP_ID=
META_EMBEDDED_SIGNUP_CONFIG_ID=
```

```bash
# apps/web/.env
VITE_META_APP_ID=
VITE_META_EMBEDDED_SIGNUP_CONFIG_ID=
```

Local webhook URL:

```text
http://localhost:3000/api/whatsapp/meta/webhook
```

Use a public HTTPS tunnel or deployed backend URL when configuring Meta webhooks outside local development.

## Production Checklist

- Set `NODE_ENV=production`.
- Set `BETTER_AUTH_URL` and `PUBLIC_BASE_URL` to the deployed API origin.
- Set `CORS_ORIGIN` to the deployed dashboard origin.
- Use a strong `BETTER_AUTH_SECRET`.
- Set `SETTINGS_ENCRYPTION_KEY` to a base64 value that decodes to 32 bytes.
- Set `METRICS_TOKEN` before exposing `GET /metrics`.
- Configure SMTP if invite emails should be sent automatically.
- Use S3/R2/MinIO storage for durable media uploads when local disk is not appropriate.
- Register OAuth/OIDC and Meta callback URLs before enabling those providers.

## Quality Checks

```bash
bun run check-types
bun run test
bun run check
bun run build
```

CI-style validation:

```bash
bun run check:ci
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Run all apps in development mode |
| `bun run dev:web` | Run only the web app |
| `bun run dev:server` | Run only the API server |
| `bun run build` | Build all workspaces |
| `bun run check-types` | Run TypeScript checks |
| `bun run test` | Run tests across workspaces |
| `bun run check` | Run Biome check and auto-fix |
| `bun run check:ci` | Typecheck, Biome check, and build |
| `bun run db:start` | Start local PostgreSQL with Docker Compose |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:push` | Push schema changes directly |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:stop` | Stop the local database container |

## UI Customization

Shared UI components and design tokens live in `packages/ui`.

- Global styles: `packages/ui/src/styles/globals.css`
- Shared components: `packages/ui/src/components`
- shadcn config: `packages/ui/components.json` and `apps/web/components.json`

Add shared primitives from the repository root:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components:

```tsx
import { Button } from "@whatsapp-flow/ui/components/button";
```

## Contributing

Contributions are welcome. Before opening a pull request:

- Keep changes scoped and consistent with the existing monorepo structure.
- Run `bun run check:ci`.
- Include migrations for schema changes.
- Add focused tests for engine, router, or provider behavior when relevant.

## License

This project is licensed under the [MIT License](LICENSE).
