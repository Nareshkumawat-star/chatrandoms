# 🌍 PulseChat

One worldwide **Global Chat** + private 1-to-1 **Chats** — real-time, with a strict technical and visual separation between the two systems.

> UI elements adapted from [Uiverse.io](https://uiverse.io) (open-source, MIT) and ambient shader backgrounds from [ThreeUI Community](https://threeui.com) (`@designcodeio/threeui`, MIT).

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, Zustand, TanStack Query, Socket.IO Client, Lucide, Framer Motion |
| Backend | Node.js, Express, TypeScript, Socket.IO (namespaces `/global` and `/dm`) |
| Database | MongoDB + Mongoose (unique indexes, TTL, cursor pagination) |
| Auth | JWT in httpOnly secure cookies, bcrypt (12 rounds), guest sessions |
| Security | Helmet, CORS, rate limiting, Zod validation, input sanitization, participant authorization |
| Files | Cloudinary (avatars) with data-URL fallback when unconfigured |
| UI | Uiverse-style components, ThreeUI `ConstellationField` / `ParticleDrift` / `TopoField` backgrounds |

## Quick Start

```bash
# 1. install
npm install                        # root (concurrently)
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. configure (optional — sane defaults for dev)
cp server/.env.example server/.env # edit MONGODB_URI if not localhost

# 3. run (server :4000 + client :5173, proxy wired)
npm run dev
```

Open **http://localhost:5173** → continue as guest or register (e.g. `@nareshk`), then in another browser register `@rahulsharma` and search `@nareshk` in **Chats**.

> **Zero-config dev:** if no MongoDB is reachable at `MONGODB_URI`, the server automatically falls back to an embedded in-memory MongoDB (dev only) so the app runs instantly. Data is ephemeral in that mode — set `MONGODB_URI` (Atlas or local) for persistence.

Optional demo data: `npm run seed` (creates searchable demo users).

## Architecture

```
pulse-chat/
├─ server/
│  └─ src/
│     ├─ config/env.ts          # typed env config
│     ├─ lib/                   # auth (JWT/bcrypt), rate limiter, cloudinary, logger
│     ├─ middleware/            # requireAuth, optionalAuth, zod validate, errors
│     ├─ models/                # User, Conversation (unique directKey), Message,
│     │                         # GlobalMessage (separate collection!), Report/Challenge/Milestone
│     ├─ routes/                # auth, users (search!), chats, messages, global, upload
│     ├─ services/              # presence, unread
│     ├─ socket/                # /global + /dm namespaces, separate handlers
│     └─ scripts/               # seed + smoke tests
└─ client/
   └─ src/
      ├─ components/
      │  ├─ uiverse/            # GlowButton, NeonInput, Toggle, Spinner (Uiverse-adapted)
      │  ├─ threeui/            # PulseBackground (ThreeUI shader backgrounds)
      │  └─ common/             # Avatar, Modal, UserProfileModal
      ├─ pages/                 # AuthPage, AppLayout, GlobalChat, Chats, Settings
      ├─ store/                 # zustand: auth, ui
      └─ lib/                   # axios api, socket singletons
```

## The Two Systems (strictly separated)

| | 🌍 Global Chat | 💬 Chats (private) |
|---|---|---|
| Collection | `GlobalMessage` | `Conversation` → `Message` |
| Socket namespace | `/global` (room `global-chat`) | `/dm` (rooms `user:<id>`) |
| Events | `global:message`, `global:reaction`, … | `dm:send/new/typing/read/edit/delete/reaction` |
| Discovery | none — one chat for everyone | username search (Chats section ONLY) |
| Grouping | exactly ONE chat, no rooms | exactly ONE conversation per pair (`directKey`) |

- `GlobalMessage` documents never carry a `conversationId`; private `Message` documents always do.
- Every private read/write verifies `currentUserId ∈ conversation.participants` (verified by tests).
- `directKey = smallerUserId:largerUserId` with a unique index → re-searching a user opens the same conversation.

## Unique Global Chat Features

World Pulse indicator · live online count · Trending Now · Live Reaction Storm (floating emoji) ·
Question Mode (auto-detected `?` messages + filter) · Daily Global Challenge (deterministic per UTC day) ·
Global Reputation · Global Milestones progress · Expiring Messages (TTL, ⏱ composer toggle) ·
Message Threads (reply snapshots, no rooms) · Anonymous Display Mode · Personal Noise Filter (3 levels) ·
Message editing/deletion · Report · Block · Mute · rate limiting & anti-spam.

## API

```
POST   /api/auth/guest|register|login|logout|refresh     GET /api/auth/me
GET    /api/users/search?q=                              GET /api/users/:username
PATCH  /api/users/me
POST   /api/users/:userId/block|mute|report
GET    /api/chats                                        POST /api/chats/direct {username}
GET    /api/chats/:conversationId/messages?before&limit  POST /api/chats/:conversationId/messages
PATCH  /api/messages/:messageId                          DELETE /api/messages/:messageId
POST   /api/messages/:messageId/reaction
GET    /api/global/messages?mode=latest|trending|questions
POST   /api/global/messages                              GET /api/global/meta
POST   /api/global/messages/:messageId/report
POST   /api/upload/avatar
```

## Production Notes

- Set `NODE_ENV=production`, strong `JWT_*_SECRETS`, `CLIENT_ORIGIN(s)`, MongoDB Atlas `MONGODB_URI`, Cloudinary keys.
- Cookies become `secure` automatically in production.
- Same-origin deploy recommended (serve `client/dist` behind the same domain / reverse proxy) so cookies & sockets stay simple; otherwise set `VITE_API_URL` and configure CORS origins.
- Verify: `cd server && npx tsx src/scripts/smoke.ts` — 24 REST checks (auth, directKey dedupe, authorization, data separation, guest rules) — and `npx tsx src/scripts/socketTest.ts` — live realtime checks (cookie-auth sockets, `/global` broadcast, DM privacy, typing, read receipts, reactions) against a running server.
