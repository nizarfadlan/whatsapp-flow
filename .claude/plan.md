# WhatsApp Flow Builder — Implementation Plan

## Overview

Build a visual flow builder for WhatsApp bots (like n8n/Typebot) inside the existing monolith. Multi-device support via Baileys (`baileys@7.x` from `@whiskeysockets/Baileys`). Users can manage multiple WhatsApp devices and build automation flows with a drag-and-drop canvas.

---

## Current State

| Layer | Stack |
|---|---|
| Monorepo | Turborepo + Bun workspaces |
| Server | Hono + tRPC + better-auth |
| Web | TanStack Start (Vite) + TanStack Router + React 19 |
| DB | Drizzle ORM + PostgreSQL (docker) |
| UI | shadcn/ui (base-ui) + Tailwind v4 |
| API | `@whatsapp-flow/api` (tRPC routers) |
| Auth | `@whatsapp-flow/auth` (better-auth, email/password) |

Backend reference (`backend/`) uses NestJS + TypeORM with `workspace_flow` (nodes/edges as JSONB) and `blocks` pattern. We'll port the same data model to Drizzle.

---

## Architecture

```
monolith/
├── apps/
│   ├── server/          ← Hono server (add Baileys WA service here)
│   └── web/             ← TanStack Start frontend
├── packages/
│   ├── api/             ← tRPC routers (add device, flow, block routers)
│   ├── auth/            ← better-auth (no changes)
│   ├── db/              ← Drizzle schemas (add device, flow, block tables)
│   ├── env/             ← env validation (add WA-related env vars)
│   ├── ui/              ← shadcn components (add new components)
│   ├── config/          ← biome/ts config
│   └── whatsapp/        ← NEW: Baileys wrapper package
```

---

## Phase 1: Database Schema (`packages/db`)

### New Tables

**1. `device` — WhatsApp devices (multi-device)**
```
id              text        PK (nanoid)
userId          text        FK → user.id
name            text        display name ("Marketing Bot", "Support")
phoneNumber     text        nullable (set after QR scan)
status          enum        'disconnected' | 'connecting' | 'connected' | 'banned'
sessionData     jsonb       Baileys auth state (creds)
createdAt       timestamp
updatedAt       timestamp
```

**2. `flow` — Automation flows**
```
id              text        PK (nanoid)
userId          text        FK → user.id
deviceId        text        FK → device.id (nullable, assigned when deployed)
name            text        flow name
description     text        nullable
nodes           jsonb       React Flow nodes array
edges           jsonb       React Flow edges array
isActive        boolean     default false
triggerType     enum        'keyword' | 'any_message' | 'webhook' | 'schedule'
triggerConfig   jsonb       keyword pattern, cron expression, etc.
createdAt       timestamp
updatedAt       timestamp
```

**3. `flow_execution_log` — Execution history**
```
id              text        PK
flowId          text        FK → flow.id
deviceId        text        FK → device.id
contactNumber   text        the WA number that triggered
status          enum        'running' | 'completed' | 'failed'
startedAt       timestamp
completedAt     timestamp
error           text        nullable
nodeResults     jsonb       per-node execution results
```

### Relations
- `user` → many `device`, many `flow`
- `device` → many `flow`
- `flow` → many `flow_execution_log`

### Files to create/modify:
- `packages/db/src/schema/device.ts` — device table + relations
- `packages/db/src/schema/flow.ts` — flow + flow_execution_log tables + relations
- `packages/db/src/schema/index.ts` — re-export new schemas
- `packages/db/src/schema/auth.ts` — add user relations to device/flow

---

## Phase 2: WhatsApp Package (`packages/whatsapp`) — NEW

A standalone Baileys wrapper that manages WA socket connections.

### Features:
- Connection manager (connect/disconnect per device)
- QR code generation for pairing
- Auth state storage/retrieval (from DB `device.sessionData`)
- Message sending (text, image, video, document, location, buttons, list, reaction)
- Message receiving (webhook-style event emitter)
- Multi-device support (multiple concurrent sockets)

### Key files:
- `packages/whatsapp/package.json`
- `packages/whatsapp/src/index.ts` — exports
- `packages/whatsapp/src/connection-manager.ts` — manages multiple Baileys sockets
- `packages/whatsapp/src/auth-state.ts` — Drizzle-based auth state (replaces file-based useMultiFileAuthState)
- `packages/whatsapp/src/message-handler.ts` — incoming message → flow trigger matching
- `packages/whatsapp/src/message-sender.ts` — send messages by block type

### Dependencies:
- `baileys` (latest from npm)
- `@whatsapp-flow/db`
- `@whatsapp-flow/env`

---

## Phase 3: tRPC API Routers (`packages/api`)

### New routers:

**`routers/device.ts`** — device CRUD + connection
- `device.list` — list user's devices
- `device.create` — register new device (returns id)
- `device.delete` — remove device
- `device.getQR` — get QR code for pairing (SSE or polling)
- `device.disconnect` — disconnect socket
- `device.reconnect` — reconnect socket
- `device.status` — current connection status

**`routers/flow.ts`** — flow CRUD
- `flow.list` — list user's flows (with pagination)
- `flow.getById` — single flow with nodes/edges
- `flow.create` — create new flow
- `flow.update` — update flow (name, nodes, edges, trigger)
- `flow.delete` — delete flow
- `flow.toggleActive` — activate/deactivate flow
- `flow.deploy` — assign flow to device and activate
- `flow.duplicate` — clone a flow

**`routers/flow-log.ts`** — execution logs
- `flowLog.list` — list execution logs (filtered by flow/device)
- `flowLog.getById` — single log detail

### Files:
- `packages/api/src/routers/device.ts`
- `packages/api/src/routers/flow.ts`
- `packages/api/src/routers/flow-log.ts`
- `packages/api/src/routers/index.ts` — merge new routers into appRouter

---

## Phase 4: Server Integration (`apps/server`)

### WhatsApp Service Integration:
- Initialize `ConnectionManager` on server start
- Reconnect all `connected` devices on boot-up
- WebSocket endpoint for real-time QR code + status updates (Hono WebSocket or SSE)
- Incoming message handler → match flows → execute nodes

### Flow Execution Engine:
- Walk the flow graph (nodes/edges) on trigger
- Execute each node sequentially following edges
- Support conditional branching (edge conditions)
- Log execution to `flow_execution_log`

### Server changes:
- `apps/server/src/index.ts` — init WA connection manager, add SSE endpoint
- `apps/server/src/wa-service.ts` — flow execution engine
- `apps/server/src/sse.ts` — SSE endpoint for device status/QR

---

## Phase 5: Frontend — Dashboard Layout (`apps/web`)

### Navigation update:
Convert to sidebar-based dashboard layout (like n8n/Typebot):
```
┌────────────────────────────────────────────┐
│ Header: Logo + User Menu                    │
├──────────┬─────────────────────────────────┤
│ Sidebar  │                                 │
│          │                                 │
│ Devices  │    Main Content Area             │
│ Flows    │                                 │
│ Logs     │                                 │
│          │                                 │
│          │                                 │
│ Settings │                                 │
└──────────┴─────────────────────────────────┘
```

### Route structure:
```
/                          → Landing page
/login                     → Login
/dashboard                 → Dashboard home (stats overview)
/dashboard/devices         → Device list
/dashboard/devices/$id     → Device detail + status
/dashboard/flows           → Flow list
/dashboard/flows/new       → Create new flow (opens editor)
/dashboard/flows/$id       → Flow editor (canvas)
/dashboard/logs            → Execution logs
```

### Files:
- `apps/web/src/routes/dashboard.tsx` → layout with sidebar
- `apps/web/src/routes/dashboard/index.tsx` → overview stats
- `apps/web/src/routes/dashboard/devices.tsx` → device list
- `apps/web/src/routes/dashboard/devices.$id.tsx` → device detail
- `apps/web/src/routes/dashboard/flows.tsx` → flow list
- `apps/web/src/routes/dashboard/flows.new.tsx` → new flow (redirects to editor)
- `apps/web/src/routes/dashboard/flows.$id.tsx` → flow editor
- `apps/web/src/routes/dashboard/logs.tsx` → execution logs

---

## Phase 6: Frontend — Device Management

### Device List Page (`/dashboard/devices`):
- Table/card view of devices
- Status badge (connected/disconnected/connecting)
- Quick actions: connect, disconnect, delete
- "Add Device" button

### Add Device Flow:
1. Click "Add Device" → dialog to name the device
2. Creates device record in DB
3. Shows QR code modal (real-time via SSE)
4. User scans QR with WhatsApp
5. Status updates to "connected"
6. QR modal closes automatically

### Device Detail (`/dashboard/devices/$id`):
- Device info (name, phone, status)
- Linked flows
- Recent messages (optional, phase 2)
- Reconnect / Logout buttons

### New UI components needed (add to `packages/ui`):
- `badge.tsx` — status badges
- `dialog.tsx` — modal dialogs
- `table.tsx` — data tables
- `sidebar.tsx` — dashboard sidebar
- `tabs.tsx` — tab components
- `separator.tsx` — visual separator
- `avatar.tsx` — user/device avatar
- `sheet.tsx` — slide-out panel (mobile sidebar)
- `tooltip.tsx` — tooltips

---

## Phase 7: Frontend — Flow Builder (Core Feature)

### Technology: `@xyflow/react` (React Flow v12)

### Flow Editor (`/dashboard/flows/$id`):
```
┌──────────────────────────────────────────────────┐
│ Toolbar: Flow name | Save | Deploy | Settings    │
├──────────┬───────────────────────────────────────┤
│ Node     │                                       │
│ Palette  │        React Flow Canvas               │
│          │                                       │
│ ─Trigger │    [Start] ──→ [Send Text] ──→ [End]  │
│ ─Message │                                       │
│ ─Media   │                                       │
│ ─Logic   │                                       │
│ ─Action  │                                       │
│          │                                       │
├──────────┴───────────────────────────────────────┤
│ Node Config Panel (when node selected)            │
└──────────────────────────────────────────────────┘
```

### Node Types (ported from backend `TypeDataBlock` + expanded):

**Trigger Nodes:**
- `trigger-keyword` — matches specific keyword(s)
- `trigger-any` — any incoming message
- `trigger-webhook` — external HTTP trigger
- `trigger-schedule` — cron-based trigger

**Message Nodes:**
- `send-text` — send text message
- `send-image` — send image
- `send-video` — send video
- `send-audio` — send audio
- `send-document` — send document/file
- `send-location` — send location pin
- `send-reaction` — react to message

**Interactive Nodes:**
- `send-button` — buttons message (up to 3 buttons)
- `send-list` — list/menu message
- `send-quick-reply` — quick reply buttons

**Logic Nodes:**
- `condition` — if/else branching (check message content, contact, etc.)
- `delay` — wait X seconds/minutes
- `set-variable` — store value in flow context
- `random` — random path (A/B testing)

**Action Nodes:**
- `forward` — forward message to another number
- `webhook-call` — call external API
- `end` — end flow

### Node configuration panel:
Each node type has its own config form. When a node is selected on the canvas, a side panel slides in with the relevant form fields.

### Dependencies to add (web):
- `@xyflow/react` — React Flow canvas
- `zustand` — flow editor state management (React Flow recommends this)

---

## Phase 8: Flow Engine (Runtime)

### Execution model:
1. Incoming WA message → `message-handler.ts` (in `packages/whatsapp`)
2. Match message against active flows for this device
3. If match found → create execution log → start walking the flow graph
4. For each node: execute action, follow outgoing edge(s)
5. Conditional nodes → evaluate condition → pick correct edge
6. Delay nodes → schedule continuation (setTimeout or queue)
7. End node → mark execution as completed

### Flow context (per execution):
```typescript
interface FlowContext {
  executionId: string;
  flowId: string;
  deviceId: string;
  contact: { number: string; name?: string };
  message: { text?: string; type: string; raw: any };
  variables: Record<string, any>;
  currentNodeId: string;
}
```

---

## Implementation Order

| Step | What | Package | Estimated effort |
|------|-------|---------|-----------------|
| 1 | DB schemas (device, flow, flow_execution_log) | `packages/db` | Small |
| 2 | Env vars update | `packages/env` | Tiny |
| 3 | New `packages/whatsapp` with Baileys | `packages/whatsapp` | Medium |
| 4 | tRPC routers (device, flow, flow-log) | `packages/api` | Medium |
| 5 | Server integration (WA service, SSE) | `apps/server` | Medium |
| 6 | New shadcn UI components | `packages/ui` | Small |
| 7 | Dashboard layout + sidebar | `apps/web` | Small |
| 8 | Device management pages | `apps/web` | Medium |
| 9 | Flow list page | `apps/web` | Small |
| 10 | Flow editor (React Flow canvas) | `apps/web` | Large |
| 11 | Node types + config panels | `apps/web` | Large |
| 12 | Flow execution engine | `apps/server` | Medium |
| 13 | Execution logs page | `apps/web` | Small |

---

## Key Design Decisions

1. **React Flow (`@xyflow/react`)** for the canvas — industry standard, same lib used by n8n
2. **Nodes/Edges as JSONB** — same pattern as existing backend, avoids complex relational mapping for graph data
3. **SSE for QR/status** — simpler than WebSockets for unidirectional real-time (Hono supports SSE natively)
4. **Baileys auth state in DB** — instead of file system, allows multi-instance deployment
5. **One flow per trigger** — a device can have multiple flows, each with its own trigger condition
6. **Zustand for editor state** — React Flow official recommendation for managing editor state
