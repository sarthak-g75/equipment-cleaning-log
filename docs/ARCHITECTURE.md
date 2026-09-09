# Architecture

How the backend is put together, and why. This complements [NOTES.md](../NOTES.md),
which covers the domain decisions.

## Layers

```
HTTP request
  → request logger        assigns/propagates x-request-id
  → helmet, cors, rate limiter
  → validation middleware Zod-parses params/query/body
  → controller            extracts validated input, calls one service method
                          (built from injected services, not from the container)
  → service               business rules, owns transaction boundaries
  → repository (port)     an interface, not a class
  → Prisma adapter        the only code that knows about Prisma
  → PostgreSQL
```

Data flows downward only. A controller never touches the database; a repository
never contains a business rule.

## Dependency inversion

The service layer depends on interfaces declared in `src/shared/ports.ts`, never on
Prisma:

```
modules/*/**.service.ts  ──depends on──▶  shared/ports.ts  ◀──implements──  database/prisma-repositories.ts
                                                   ▲
                                                   └──implements──  tests/helpers/fakes.ts
```

`src/container.ts` is the composition root — the single place that knows which concrete
adapter backs each port. It is wired by hand: with one implementation per port, a DI
container would add indirection and a dependency without removing any coupling.

The inversion runs all the way out to the transport. `createApp(services)` takes its
services as a parameter, `createApiRouter(services)` passes them to each router factory,
and each controller is built from them:

```
container.ts ──▶ createApp ──▶ createApiRouter ──▶ create*Router ──▶ create*Controller
```

Controllers used to `import { services } from '../../container'` directly. That is a
service locator, not injection: the dependency pointed at the composition root, and
nothing in the HTTP layer could be exercised without a live Prisma client behind it.

Two related layering fixes: token minting lives in `lib/tokens.ts` rather than in
`middleware/auth.ts`, so `auth.service.ts` no longer imports from the transport layer to
issue a token; and `lib/pagination.ts` is parameterised over its sort column
(`createKeysetPaginator`) rather than hardcoding `cleanedAt`, so the next paginated list
can reuse it instead of copying it.

**What this buys, concretely:** 57 of the API's 121 tests run with no database at all, in
milliseconds. That includes `tests/unit/http.test.ts`, which mounts the entire HTTP stack
— middleware, validation, controllers, services — over in-memory repositories; before the
controllers took their services as a parameter, every HTTP-level assertion needed
Postgres. The integration suite is then free to test only what genuinely needs a real
database: the keyset query, the row lock, and transactional rollback.

## Where each SOLID principle actually shows up

Listed because the mapping should be concrete, not decorative:

| Principle | Where |
|---|---|
| **Single responsibility** | Services hold business rules; repositories hold queries; `diff.ts` does nothing but compare two states. The Prisma adapter is the only file that knows the ORM exists. |
| **Open/closed** | `DEFAULT_REFERENCE_RESOLVERS` in `audit.service.ts`. Teaching the audit trail to resolve a new kind of reference means adding a resolver to the registry, not editing the resolver's logic. `createAuditService` takes the list as a parameter, so a caller can extend it without modifying it. |
| **Liskov substitution** | The in-memory fakes are used wherever the Prisma repositories are, and the services cannot tell the difference — which is exactly what the unit suite demonstrates. The fakes implement the keyset walk, the cursor scope check and the change-set grouping for real; a fake that quietly ignored a parameter would make a broken test pass, which is worse than having no test. |
| **Interface segregation** | Ports are per-aggregate (`EquipmentRepository`, `AuditRepository`, …) rather than one fat `Database` interface, so a fake only has to implement what its subject actually calls. |
| **Dependency inversion** | Services receive a `UnitOfWork`; controllers and routers receive their services; `createApp(services)` closes the loop. Nothing in `modules/` imports the Prisma client, and nothing outside `container.ts` imports the container's instances. |

Where SOLID was **deliberately not** applied: there is no interface for services
themselves beyond the type they export, no abstract factory, and no container. Those
would be indirection with a single implementation behind it. The brief asks for code
that avoids over-engineering, and an abstraction with one implementation and no second
caller is exactly that.

## Transactions

`UnitOfWork.transaction()` hands the callback a set of repositories bound to that
transaction. A service therefore cannot accidentally perform half an operation outside
it — the only repositories in scope are the transactional ones. This is what makes
"the record write and its audit write cannot diverge" a structural property rather
than a convention, and there is an integration test that forces the audit insert to
fail and asserts the record update rolled back.

## Observability

- **Structured JSON logs** (pino), with sensitive fields redacted globally rather than
  at each call site.
- **Type-aware linting** is switched on in both workspaces, which is what makes
  `no-floating-promises` and `no-misused-promises` run at all. Without a program behind
  the parser those rules are silently inert — and in a codebase that leans on Express 5
  forwarding rejected promises, an unawaited promise is the dominant failure mode.
- **Request correlation**: every response carries `x-request-id`, generated or
  propagated from the caller (validated first — an inbound id is attacker-controlled text
  headed for a response header and every log line for that request). It is on every log line for that request, which is what
  turns "it broke at about 3pm" into a specific request.
- **Two health probes**, deliberately different: `/health/live` never touches the
  database, so a database outage cannot make an orchestrator kill every replica;
  `/health/ready` does, so an instance that cannot serve is pulled from the load
  balancer.

## Known scaling limits

Stated rather than pretended away:

- **Rate limiting is in-process memory.** Correct for one instance, wrong the moment
  the API scales horizontally, where the store must move to Redis.
- **Audit history is capped, not paginated** (`limit`, default 100, max 200). The cap
  counts change sets, not rows, and the response reports `meta.hasMore` — a truncated
  trail that looks complete is the one thing an audit endpoint must not return.
- **The keyset predicate is expressed through Prisma's `OR`.** The index-optimal form
  is SQL's row-value comparison `(cleaned_at, id) < ($1, $2)`, which Prisma cannot
  express; that is the `$queryRaw` upgrade if the endpoint ever gets hot.
- **No caching layer.** Every read hits Postgres. Equipment is the obvious candidate
  for a short TTL if read volume grows.
- **Change sets written in the same millisecond are tie-broken on `changeSetId`** —
  arbitrary, but stable, so history cannot reorder between refreshes. A monotonic
  sequence column would make it chronological; see NOTES.md for why it is not worth a
  `BigInt` on every audit row at this size.
