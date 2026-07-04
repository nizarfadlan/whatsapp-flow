# whatsapp-flow

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Start, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - SSR framework with TanStack Router
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Husky** - Git hooks for code quality
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Auth, Admin Settings, and Whitelabel Setup

Authentication uses Better Auth with local database tables. It does not require Clerk or another hosted auth product.

### Required server env

Copy `apps/server/.env.example` to `apps/server/.env`, then set at minimum:

```bash
BETTER_AUTH_SECRET={your_secret_key}
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001
DATABASE_URL=postgresql://{username}:{password}@{host}:{port}/{dbname}
```

For the admin settings screen and DB-managed OAuth/OIDC provider secrets, also set:

```bash
# Comma-separated emails that can access Dashboard > Settings before roles are assigned.
ADMIN_EMAILS=admin@example.com

# Required when saving OAuth/OIDC client secrets from the settings UI.
# Generate with: openssl rand -base64 32
SETTINGS_ENCRYPTION_KEY={base64_32_byte_key}
```

### Apply auth/settings migrations

Run migrations before opening the settings UI:

```bash
bun run db:migrate
```

This creates the app settings table, auth provider settings table, and the user role column.

### Access the settings UI

1. Sign in with an email listed in `ADMIN_EMAILS`, or set a user's database role to `admin`.
2. Open `Dashboard > Settings`.
3. Use the Branding section to change the app name, tagline, logo, favicon, primary color, and support email.
4. Use the Auth Providers section to configure built-in OAuth providers or dynamic OIDC connections.

### OAuth and OIDC callback URLs

Register the callback URL shown in the settings UI with the provider.

Built-in OAuth providers use provider-specific callback URLs:

```text
/api/auth/callback/google
/api/auth/callback/github
```

OIDC/Generic OAuth connections use a generated immutable provider ID:

```text
/api/auth/oauth2/callback/{providerId}
```

Use the full server URL when registering callbacks, for example `http://localhost:3000/api/auth/oauth2/callback/oidc-acme-sso` in local development.

### Dynamic OIDC connection setup

OIDC connections are stored in the database and can be created from `Dashboard > Settings`:

1. Create an OIDC connection with a display name.
2. Copy the generated callback URL.
3. Register that callback URL in the identity provider.
4. Fill the client ID, client secret, discovery URL or manual authorization/token/userinfo endpoints.
5. Enable the connection.
6. Restart the server so Better Auth reloads the Generic OAuth configuration.

The generated provider ID is stable and should not be changed because linked accounts and callback URLs depend on it. Discovery URL is preferred when your identity provider supports it.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@whatsapp-flow/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Git Hooks and Formatting

- Initialize hooks: `bun run prepare`
- Format and lint fix: `bun run check`

## Project Structure

```
whatsapp-flow/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Start)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Biome formatting and linting
