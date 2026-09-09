# Equipment Cleaning Log

A small full-stack slice of a pharmaceutical manufacturing system: equipment, the
cleaning records logged against it, and a field-level audit trail over every change.

- **API** — Node 20, TypeScript, Express 5, Prisma 6, PostgreSQL 16
- **Web** — React 19, TypeScript, Vite 8, Tailwind 4, TanStack Query, React Hook Form + Zod
- **Tests** — Vitest, supertest (API), Testing Library + MSW (web)

See [NOTES.md](./NOTES.md) for the design decisions, trade-offs, and what was left out.

---

## Quick start with Docker

Requires Docker Desktop (running) and nothing else.

```bash
cp .env.example .env       # optional; the defaults in docker-compose.yml work as-is
docker compose up --build
```

That brings up Postgres, applies migrations, seeds demo data, and serves both apps:

| | URL |
|---|---|
| Web | <http://localhost:5173> |
| API | <http://localhost:4000/api/v1> |
| Health check | <http://localhost:4000/health> |

Sign in with one of the seeded users (password `password123` for all three):

| Email | Role | Can do |
|---|---|---|
| `alice@example.com` | qa | everything, including verifying records |
| `bob@example.com` | operator | log and edit records, but not verify them |
| `carol@example.com` | operator | as above |

To stop and discard the database volume: `docker compose down -v`.

---

## Running locally without Docker

You need Node 20.19+ (or 22+) and a PostgreSQL 16 instance.

### 1. Database

Either start just the database from compose:

```bash
docker compose up -d db          # Postgres on localhost:5433
```

…or point `DATABASE_URL` at your own instance in the next step.

The test suite uses a **separate** database (`cleaning_log_test`). You don't need to
create it — the Vitest global setup creates and migrates it on first run.

### 2. API

```bash
cd api
cp .env.example .env             # defaults match the compose Postgres on port 5433
npm install
npm run db:migrate               # applies migrations, generates the Prisma client
npm run db:seed                  # 3 users, 6 equipment, 60 cleaning records
npm run dev                      # http://localhost:4000
```

### 3. Web

In a second terminal:

```bash
cd web
cp .env.example .env             # VITE_API_URL=http://localhost:4000/api/v1
npm install
npm run dev                      # http://localhost:5173
```

---

## Tests

```bash
cd api && npm test               # 53 tests: unit + integration + e2e
cd web && npm test               # 12 tests: components with a mocked network
```

The API's unit tests (the audit diff and the cursor codec) need no database. The
integration and e2e suites need `TEST_DATABASE_URL` (set in `api/.env.example`) — without
it they **skip** and print a warning rather than failing silently, so check the output says
they ran. The test database is created and migrated automatically on first run.

What the tests are actually for:

| Suite | Proves |
|---|---|
| `api/src/lib/audit/diff.test.ts` | Field-level diffing: date-identity, omitted vs. explicitly-null vs. unchanged, whitelist enforcement |
| `api/src/lib/pagination.test.ts` | Cursor round-trip, tamper rejection, `hasMore` probe logic |
| `api/tests/integration/pagination.test.ts` | Paging yields every row exactly once — including rows sharing a `cleanedAt` — and is unaffected by concurrent inserts |
| `api/tests/integration/audit.test.ts` | Audit writes are correct, and a failed audit write rolls the record update back |
| `api/tests/e2e/api.test.ts` | Auth, authorisation, the full record lifecycle over HTTP, error envelopes |
| `web/src/features/cleaning-records/**` | Audit drawer renders old → new and fetches lazily; the form maps server errors onto fields |

Other checks:

```bash
cd api && npm run lint && npm run typecheck
cd web && npm run lint && npm run typecheck
```

---

## API reference

Base path `/api/v1`. Every route except `/health` and `/auth/login` requires
`Authorization: Bearer <token>`.

Success responses are `{ "data": ... }`, plus `"meta"` on paginated lists.
Errors are `{ "error": { "code", "message", "details"? } }`, where `code` is a stable
string clients can branch on.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | No auth. Used by the compose healthcheck. |
| `POST` | `/auth/login` | `{ email, password }` → `{ token, user }` |
| `GET` | `/auth/me` | The current user, from the token |
| `GET` | `/equipment` | `?status=active\|retired` |
| `POST` | `/equipment` | `201` + `Location` |
| `GET` | `/equipment/:id` | |
| `PATCH` | `/equipment/:id` | Audited |
| `DELETE` | `/equipment/:id` | `204`, or `409 EQUIPMENT_IN_USE` if it has cleaning records |
| `GET` | `/equipment/:id/audit` | Change history for the equipment itself |
| `GET` | `/equipment/:equipmentId/cleaning-records` | `?limit=&cursor=&status=` — keyset paginated |
| `POST` | `/equipment/:equipmentId/cleaning-records` | Writes the record and its `CREATE` audit in one transaction |
| `GET` | `/cleaning-records/:id` | |
| `PATCH` | `/cleaning-records/:id` | `cleanedBy`, `cleanedAt`, `method`, `notes` — **not** `status` |
| `POST` | `/cleaning-records/:id/verify` | Role `qa` only. `pending → verified` |
| `GET` | `/cleaning-records/:id/audit` | Change sets, newest first |

### Pagination

```
GET /api/v1/equipment/:equipmentId/cleaning-records?limit=10&status=pending
```

```jsonc
{
  "data": [ /* … */ ],
  "meta": { "limit": 10, "hasMore": true, "nextCursor": "eyJ0IjoiMjAyNi0w…" }
}
```

Pass `meta.nextCursor` back as `?cursor=` to get the next page; `hasMore: false` and
`nextCursor: null` mean you have reached the end. The cursor is opaque — treat it as a
token, not a parseable value. There is deliberately no `total`; see NOTES.md.

### Try it

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"password123"}' | jq -r .data.token)

curl -s http://localhost:4000/api/v1/equipment -H "Authorization: Bearer $TOKEN" | jq
```

---

## Project layout

```
api/
  prisma/            schema.prisma, migrations (committed), seed.ts
  src/
    config/          Zod-validated env, parsed once, fails fast at startup
    database/        the Prisma singleton
    lib/
      audit/         diff.ts, serialize.ts, audit.repository.ts  ← the audit core
      pagination.ts  cursor encode/decode + the keyset predicate
      errors.ts      AppError hierarchy
    middleware/      auth, validate, error-handler
    modules/         auth · equipment · cleaning-records · audit
    app.ts           the app, without listen(), so supertest can mount it
  tests/             integration + e2e, helpers, global setup

web/src/
  app/               App, router, providers, error boundary
  pages/             login · equipment list · equipment detail
  features/          auth · equipment · cleaning-records (components/hooks/validators)
  components/        Button, Badge, Dialog, Field, loading/error/empty states
  services/          the Axios instance, interceptors, ApiError
  tests/             setup, MSW handlers, renderWithProviders
```

The two files most worth reading first are `api/src/lib/audit/diff.ts` and
`api/src/lib/pagination.ts`.
