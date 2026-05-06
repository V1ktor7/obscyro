# Obscyro

> **Beta — active test phase.** Endpoints, schemas, and pricing may change without notice. Feedback welcome.

Healthcare semantic interoperability API platform — Fastify + PostgreSQL backend with a Next.js documentation and marketing site.

## Prerequisites

- **Node.js** 20 or newer
- **Docker Desktop** (or Docker Engine) for local PostgreSQL with pgvector

## Repository layout

- **`backend/`** — Fastify API (TypeScript, PostgreSQL via `pg`, no ORM)
- **`frontend/`** — Next.js 14 App Router site (Tailwind, docs/marketing shell)

## Backend setup

Environment variables are documented in [`backend/.env.example`](backend/.env.example). Create a local `.env` from that file and align `DATABASE_URL` with the credentials in [`backend/docker-compose.yml`](backend/docker-compose.yml).

```bash
cd backend
npm install
copy .env.example .env
```

Edit `backend/.env` so `DATABASE_URL` matches `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and host `localhost:5432`.

Start PostgreSQL 16 (pgvector image) and the API:

```bash
npm run db:up
npm run dev
```

Verify health:

```bash
curl http://localhost:3001/health
```

Swagger UI is available at `/documentation` when the server is running.

Stop the database container:

```bash
npm run db:down
```

Build and run production server:

```bash
npm run build
npm start
```

Run the SNOMED import stub:

```bash
npm run import:snomed
```

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:3000`).

## Windows note

The examples use `copy .env.example .env` for Command Prompt or PowerShell. On macOS/Linux, use `cp .env.example .env`.
