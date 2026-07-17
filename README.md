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

## Docker Deployment

Use the root Compose setup to run the API server and web dashboard in production-style containers. Set `DATABASE_URL` in `.env.docker` to your production database, or start the bundled local Postgres profile for self-host testing.

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker` and replace the secret placeholders. Generate strong values with:

```bash
openssl rand -base64 32
```

For a local self-host smoke test, start the bundled Postgres service first:

```bash
docker compose --env-file .env.docker --profile local-db up -d postgres
```

Build the images, run migrations, and start the app stack:

```bash
bun run docker:build
bun run docker:migrate
bun run docker:up
```

Open:

- Web dashboard: [http://localhost:3001](http://localhost:3001)
- API server: [http://localhost:3000](http://localhost:3000)

Useful Docker commands:

```bash
bun run docker:up:detached  # start in the background
bun run docker:logs         # follow service logs
bun run docker:down         # stop containers
```

`DATABASE_URL` is the only database setting required by the app. In Docker local testing, it can target the bundled Compose hostname `postgres`; in production, point it to your managed PostgreSQL endpoint.

Local uploads use the `uploads_data` Docker volume when `STORAGE_DRIVER=local`. For durable production media, prefer S3/R2/MinIO storage and update the S3 values in `.env.docker`.

Docker runs the API and web services as non-root users, uses healthchecks for readiness, and serves the dashboard through the TanStack Start SSR production server instead of `vite preview`.

If `VITE_SERVER_URL` changes, rebuild the web image because Vite embeds that value during build.

## Environment

Minimum server configuration:

```bash
# apps/server/.env
AUTH_SECRET=replace-with-a-random-secret
AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001
# Set false only for trusted plain-HTTP deployments on one host/IP; omit or set true for HTTPS.
AUTH_USE_SECURE_COOKIES=false
DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_flow
ADMIN_EMAILS=admin@example.com
SETTINGS_ENCRYPTION_KEY=replace-with-base64-32-byte-key
PUBLIC_BASE_URL=http://localhost:3000
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=uploads
INBOUND_MEDIA_AUTO_DOWNLOAD=true
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

Start the built web server in another terminal:

```bash
cd apps/web
HOST=0.0.0.0 PORT=3001 bun run start
```

Open [http://localhost:3001](http://localhost:3001).

Build outputs:

- Web app: `apps/web/dist` plus `apps/web/server.mjs` production SSR runner
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

## Webhook Guide

There are three webhook surfaces:

1. **Meta WhatsApp callback** receives events from Meta Cloud API.
2. **Flow trigger webhook** starts an active flow from an external system.
3. **Outbound webhooks** deliver WhatsApp Flow events to your configured endpoint.

### Meta WhatsApp callback

Use this URL when configuring Meta webhooks:

```text
GET/POST /api/whatsapp/meta/webhook
```

Responses:

| Request | Success | Error |
| --- | --- | --- |
| `GET` verification | Returns the plain `hub.challenge` text when `hub.mode=subscribe` and `hub.verify_token` matches `META_WEBHOOK_VERIFY_TOKEN`. | `403 Forbidden` |
| `POST` event callback | `200 OK` with body `OK` after the event is accepted and processed. | `401 Unauthorized` when signature validation or payload processing fails. |

Security:

- Set `META_WEBHOOK_VERIFY_TOKEN` to a random value and register the same value in Meta. This is only for Meta's subscription verification request.
- Set `META_APP_SECRET`, or store a device-level Meta app secret, so incoming callbacks can be verified against `X-Hub-Signature-256`. Treat this as required outside local testing.

### Flow trigger webhooks

Flows with `triggerType: "webhook"` can be started by calling:

```text
POST /api/flows/{flowId}/webhook?token={webhookToken}
```

You can also send the token as a header:

```text
X-Webhook-Token: {webhookToken}
```

Request body must be JSON and include a contact number. Supported contact fields are `contactNumber`, `phoneNumber`, or `number`; non-digit characters are stripped before execution. Flow input text is taken from `text`, then `message`, then the whole JSON body as a string.

```json
{
  "contactNumber": "6281234567890",
  "text": "Hello from CRM",
  "customerId": "cus_123"
}
```

Accepted response:

```json
{ "success": true }
```

Error responses:

| Status | Body | Meaning |
| --- | --- | --- |
| `400` | `{ "error": "contactNumber is required" }` | JSON body is missing a usable contact number. |
| `401` | `{ "error": "Invalid webhook token" }` | Token does not match the flow webhook token. |
| `404` | `{ "error": "Webhook flow not found" }` | Flow does not exist, is not active, or is not configured as a webhook trigger. |

`success: true` means the trigger was accepted. Flow execution continues asynchronously, so callers should not wait for the final flow result in this response.

Security:

- Yes, webhook-triggered flows should use a secret token.
- Prefer the `X-Webhook-Token` header in production so tokens are less likely to appear in URL logs, browser history, or analytics tools.
- Use HTTPS for any public webhook URL.

### Outbound webhooks

Dashboard webhook endpoints receive events via `POST` with JSON bodies.

Headers:

```text
Content-Type: application/json
User-Agent: WhatsAppFlow-Webhook/1.0
X-Webhook-Signature: {hex_hmac_sha256}
```

`X-Webhook-Signature` is `HMAC-SHA256(rawBody, endpointSecret)` encoded as lowercase hex. Verify the exact raw request body before trusting the payload. Each endpoint gets a generated `whsec_...` secret, and the dashboard can regenerate it.

Receiver response contract:

- Return any `2xx` status to mark the delivery as successful.
- Any non-`2xx` response, network error, or timeout is treated as failed and retried.
- The system stores the response status and up to the first 1024 characters of the response body for delivery inspection.
- Deliveries are retried up to 5 attempts with exponential backoff.

Payload compatibility:

- Existing fields such as `eventType`, `deviceId`, `contact`, `message.type`, `message.text`, and `message.messageKey` remain available.
- New fields such as `chat`, `sender`, `group`, `message.media`, and `message.mentions` are additive and may be absent depending on provider/message type.
- `contact.number` is the normalized phone-number field currently emitted by the app.

Supported `eventType` values:

- `message.received`
- `device.status_changed`
- `flow.execution.started`
- `flow.execution.completed`
- `flow.execution.failed`
- `flow.session.waiting`
- `flow.session.resumed`
- `flow.session.expired`

Private text example:

```json
{
  "eventType": "message.received",
  "deviceId": "dev_123",
  "provider": "baileys",
  "contact": {
    "jid": "6281234567890@s.whatsapp.net",
    "number": "6281234567890",
    "name": "Customer"
  },
  "chat": {
    "jid": "6281234567890@s.whatsapp.net",
    "type": "private",
    "isGroup": false
  },
  "sender": {
    "jid": "6281234567890@s.whatsapp.net",
    "number": "6281234567890",
    "name": "Customer",
    "identifier": "6281234567890@s.whatsapp.net"
  },
  "message": {
    "type": "conversation",
    "text": "Hi",
    "providerMessageId": "ABCD1234",
    "messageKey": {
      "id": "ABCD1234",
      "remoteJid": "6281234567890@s.whatsapp.net",
      "fromMe": false
    }
  }
}
```

Group message with mention example:

```json
{
  "eventType": "message.received",
  "deviceId": "dev_123",
  "contact": {
    "jid": "120363000000000000@g.us",
    "name": "Support Group"
  },
  "chat": {
    "jid": "120363000000000000@g.us",
    "type": "group",
    "isGroup": true
  },
  "sender": {
    "jid": "6281234567890@s.whatsapp.net",
    "number": "6281234567890",
    "name": "Customer",
    "identifier": "6281234567890@s.whatsapp.net"
  },
  "group": {
    "jid": "120363000000000000@g.us",
    "name": "Support Group",
    "participantCount": 42,
    "senderParticipant": {
      "jid": "6281234567890@s.whatsapp.net",
      "number": "6281234567890",
      "role": "member",
      "identifier": "6281234567890@s.whatsapp.net"
    }
  },
  "message": {
    "type": "extendedTextMessage",
    "text": "Halo @6289999999999",
    "mentions": [
      {
        "jid": "6289999999999@s.whatsapp.net",
        "number": "6289999999999",
        "identifier": "6289999999999@s.whatsapp.net",
        "resolved": true
      },
      {
        "lid": "987654321@lid",
        "identifier": "987654321@lid",
        "resolved": false
      }
    ]
  }
}
```

Media example:

```json
{
  "eventType": "message.received",
  "deviceId": "dev_123",
  "message": {
    "type": "image",
    "text": "Payment proof",
    "media": {
      "type": "image",
      "providerMediaId": "123456789",
      "mimeType": "image/jpeg",
      "fileName": "123456789.jpeg",
      "caption": "Payment proof",
      "size": 204800,
      "sha256": "base64-or-provider-hash",
      "stored": true,
      "storage": {
        "driver": "s3",
        "key": "whatsapp/meta/dev_123/wamid.x/123456789.jpeg",
        "url": "https://cdn.example.com/whatsapp/meta/dev_123/wamid.x/123456789.jpeg"
      }
    }
  }
}
```

Media handling notes:

- By default, Meta Cloud API and Baileys media messages are downloaded and stored using the configured storage driver (`local` or `s3`).
- Set `INBOUND_MEDIA_AUTO_DOWNLOAD=false` to skip media download/storage and keep metadata only.
- If media storage succeeds, `message.media.stored` is `true` and `message.media.storage` contains `driver`, `key`, and `url`.
- If auto-download is disabled, webhook payloads still include `message.media` metadata with `stored: false` and `storage: null`.
- If media download/storage fails, the webhook is still delivered with metadata, `stored: false`, and `storageError` so consumers can still save the message event.
- `status@broadcast` messages are ignored by inbox persistence and do not create inbox threads/messages.
- Mention targets are enriched from saved contacts when possible. If a mention cannot be resolved, the payload still includes `identifier`; LID mentions also include `lid`.

Secret verification example:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return (
    actual.length === expectedBuffer.length &&
    timingSafeEqual(actual, expectedBuffer)
  );
}
```

## Production Checklist

- Set `NODE_ENV=production`.
- Set `AUTH_URL` and `PUBLIC_BASE_URL` to the deployed API origin.
- Set `CORS_ORIGIN` to the deployed dashboard origin.
- Use a strong `AUTH_SECRET`.
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
| `bun run docker:build` | Build full-stack Docker images |
| `bun run docker:build:ci` | Build Docker images with the example env for CI validation |
| `bun run docker:migrate` | Run Drizzle migrations inside Docker |
| `bun run docker:up` | Start the Docker stack in the foreground |
| `bun run docker:up:detached` | Start the Docker stack in the background |
| `bun run docker:logs` | Follow Docker service logs |
| `bun run docker:down` | Stop the Docker stack |

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
