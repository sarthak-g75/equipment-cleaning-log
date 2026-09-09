# Notes

Design decisions, trade-offs, and what I deliberately left out.

---

## The audit trail

### One row per changed field, grouped by `changeSetId`

The obvious shortcut is one row per change event with a `changes` JSONB blob. I went with
one row per *changed field* instead, with a `changeSetId` grouping the rows written by a
single transaction back into one displayable event.

Why:

- The requirement is field-level old → new tracking, and this puts `field / oldValue /
  newValue` in the schema itself rather than burying it in an opaque column.
- "Who last changed the status of this record?" is a plain indexed lookup on
  `(entityType, entityId, field, changedAt)`. The JSONB equivalent needs `changes ?
  'status'` and a GIN index — correct, but a lot more to justify.
- It's a literal encoding of what a regulated audit trail is expected to record per data
  point (original value, new value, who, when), and it's the shape an inspector-facing CSV
  export wants: one line per changed value.

The cost is that one edit fragments into N rows. `changeSetId` plus a single shared
`changedAt` per set solves that; `audit.service.ts` regroups them in application code,
which is cheap because a single record accumulates only a handful of change sets.

I considered a normalised two-table version (an event table plus a field-changes table).
It's arguably tidier — `actorId`, `actorName`, `action` and `changedAt` are repeated on
every row here — but it costs a join and a nested write for no gain at this scale, and
denormalisation is idiomatic for an append-only audit table anyway.

`actorName` is **snapshotted onto the row rather than joined** from `User`. If someone is
later renamed, history must still show the name as it stood at the time of the change. An
audit trail that rewrites itself when a lookup table changes isn't an audit trail.

### Reference fields store the id and resolve a label for display

`cleanedById` and `equipmentId` hold UUIDs. The audit trail stores the raw id, because that
is what actually changed and it is the value that stays correct forever. But
`cleanedById: 3f1a… → 8c2b…` tells a human nothing, so the audit endpoint resolves those
ids to display labels (`oldLabel`/`newLabel`) alongside the raw values.

Resolution is batched — one query per referenced table for the whole response — rather than
a lookup per change row, which is the N+1 this endpoint would otherwise have. An id that no
longer resolves falls back to the raw value rather than rendering blank, so a deleted
reference degrades to something truthful instead of an empty cell.

### Values are stored as text, compared after serialization

`serializeAuditValue` renders every auditable value to a canonical string, and the diff
compares those strings. One rule governs the module: **the audit trail stores strings, and
if two values serialize identically there is no auditable difference.**

That single decision removes three bugs at once:

1. Two `Date` objects holding the same instant are `!==`. A reference comparison would log
   a spurious `cleanedAt` change on *every* update. This is the failure mode I most wanted
   covered by a test, and it is the first test in `diff.test.ts`.
2. `null` and `undefined` both mean "no value" and must map to SQL `NULL`.
3. An enum or number can't fail a strict check against its own string form.

It also means the value stored and the value compared are the same thing.

`text` over JSONB because every tracked field is a scalar, `NULL` is unambiguous (JSONB
forces you to distinguish JSON `null` from SQL `NULL`), and the table stays readable in
`psql` — which matters when the reader is an auditor rather than a program.

### Omitted vs. cleared vs. unchanged

These are three different things and the diff keeps them distinct:

- A field **absent** from a PATCH body is not a change. A request that doesn't mention
  `notes` must not record `notes → null`.
- A field explicitly set to **`null`** *is* a change — clearing a note is an auditable act.
- A field whose value is **unchanged** produces nothing, so a no-op PATCH writes zero audit
  rows.

Empty string is normalised to `null` at the Zod boundary rather than inside the diff, so
the "what did the client mean?" decision lives in one place and the diff stays a dumb
comparison.

`trackedFields` is a **whitelist**, not a blacklist. That's what keeps `updatedAt` — which
changes on every write — out of every change set, and it makes it impossible for a caller
to inject an arbitrary field name into the trail. The lists are declared
`as const satisfies readonly (keyof Model)[]`, so renaming a Prisma column breaks the build
instead of silently dropping a field out of the audit.

### CREATE reuses the same code path

Creation is recorded as a full change set with `oldValue: null` on every supplied field,
rather than a single "created" marker. Two reasons: a record's entire state becomes
reconstructable from the trail alone, and — the deciding factor — `diffFields(null, created,
TRACKED)` means creation and update run the *same function*. One implementation, one set of
tests, no sentinel rows for consumers to special-case.

### The two writes cannot diverge

`recordChanges()` takes a `Prisma.TransactionClient`, **not** a `PrismaClient`. That's
load-bearing: it is a compile error to write an audit row outside a transaction, so the
entity write and its trail can never be committed independently.

There's an integration test that forces the audit insert to fail (an `actorId` that
violates the foreign key) and asserts the record update rolled back. It's the test that
actually proves the guarantee rather than assuming it.

The diff runs against **the row Prisma returned**, not against the client's patch, so
anything computed server-side is audited automatically.

### Concurrency: a row lock, and what I didn't build

Updates take `SELECT … FOR UPDATE` before reading. Postgres defaults to READ COMMITTED, so
without it two concurrent PATCHes both read the same predecessor and the trail records
`A → B` and `A → C` — a forked lineage where you can't tell what the value actually was
immediately before the second edit. The final row state would still be correct; the *audit
trail* would be wrong, which is the one failure this system can't tolerate.

I deliberately did **not** add optimistic concurrency (a `version` column or `If-Match`).
It solves a different problem — one user silently overwriting another's edit — and the real
cost isn't the `where` clause, it's the tail: a 409 contract, the client holding and
resending a version, refetch-and-merge UX, and tests for all of it. With more time that's
the next thing I'd add.

---

## Pagination

Cleaning records use **keyset (cursor) pagination** on `(cleanedAt DESC, id DESC)`.

`OFFSET n` makes Postgres walk and discard n rows, so page latency degrades linearly as the
log grows. Worse, records are inserted continuously: any insert shifts every subsequent
offset, so a user paging through sees rows duplicated or silently skipped — not acceptable
for an audit-facing list. Keyset anchors the page boundary to a stable position instead, so
inserts don't disturb it and each page is an index seek.

**`cleanedAt` is not unique** — a shift changeover routinely logs several cleanings at the
same instant — so `WHERE cleanedAt < :cursor` alone would silently drop every row tying
with the page boundary. `id` is the tie-breaker. This is the part that's easy to get wrong
and invisible until it bites, so the seed data deliberately contains timestamp ties and the
integration test paginates across them at a page size that forces them to straddle a
boundary.

The predicate is written by hand in `where` rather than using Prisma's `cursor` option:
Prisma's version needs a synthetic `@@unique([cleanedAt, id])`, requires the cursor row to
still exist, and hides the comparison being tested. The explicit `OR` documents the
tie-break rule to whoever reads it next. The index-optimal form is SQL's row-value
comparison `(cleaned_at, id) < ($1, $2)`, which Prisma can't express — that would be the
`$queryRaw` upgrade if this endpoint ever got hot.

**Two composite indexes**, not one, because `status` is optional and Postgres can only use
a leading prefix: `[equipmentId, status, cleanedAt, id]` can't serve the unfiltered query,
so there's also `[equipmentId, cleanedAt, id]`.

**There is no `total`.** `COUNT(*)` over the filtered set is O(n) under Postgres MVCC — no
cheap index-only count exists — so returning it would reintroduce on every request exactly
the linear cost keyset removes. It's also stale the moment it's serialised in an
append-heavy log. `meta` is `{ limit, hasMore, nextCursor }` and nothing else.

**Forward-only**, no `prevCursor` — that needs a reversed query and a reversed cursor. The
UI is a "Load more" chain backed by `useInfiniteQuery`, which keeps prior pages cached, so
going back is free. That's the honest UI for forward-only keyset rather than fake page
numbers over it.

Equipment is *not* paginated: it's a bounded reference list of tens of rows. The
interesting pagination is on cleaning records, and paginating both would have been ceremony.

---

## Domain decisions

These are assumptions I made where the brief left room. Each was a judgement call.

**`cleanedBy` is a relation to `User`, and is still distinct from the audit actor.**
These are two different people and the model keeps them apart: `cleanedById` is who
physically performed the cleaning, while the audit actor is whoever was authenticated when
the record was written or changed. An operator can log a cleaning that a colleague carried
out, and the trail records both facts truthfully.

I first modelled `cleanedBy` as free text, reasoning that a shop-floor operator may not
have a login. That was the wrong call: a name string can't answer "show me everything this
person cleaned" without a fragile match, and it silently goes stale when someone is
renamed. A foreign key fixes both. If unlicensed operators genuinely need recording, the
right answer is a `User` row that cannot log in, not a free-text column.

Because the table already held rows, the change ships as the standard three-step migration
— add nullable, backfill, enforce `NOT NULL`. The backfill matches the legacy abbreviated
names ("B. Novak") against `User.name` on surname plus first initial, and falls back to the
earliest user for anything unmatched. It also handles the degenerate case of rows to
attribute but no users to attribute them to, by creating a clearly-labelled placeholder
with an unusable password hash — deleting unattributable cleaning records would destroy
audit history, which is the one thing this system must not do.

**`status` is not patchable.** Verification is a separate, role-gated transition:
`POST /cleaning-records/:id/verify`, restricted to `qa`. If `status` were in the PATCH body,
an operator could sign off their own cleaning record — an authorisation hole, and
meaningless as a quality workflow. This is a small deviation from a literal reading of the
brief (which lists `status` as a record field) and I think it's the right call; it's also
why there's an e2e test asserting an operator gets a 403.

**A verified record cannot be edited** (409). It's a signed-off quality document; editing
it in place would destroy the meaning of the signature. The UI hides the Edit button rather
than offering a dead end.

**Equipment with cleaning records cannot be deleted** (409, pointing at retirement).
`onDelete: Restrict` enforces it at the database too. Deleting it would orphan an audit
trail, which is the one thing this system exists to prevent. Unused equipment hard-deletes,
so the brief's "CRUD" is genuinely complete.

**The audit table is append-only by convention** — no route or call site updates or deletes
an `AuditEntry`. In production I'd enforce that at the database with `REVOKE UPDATE, DELETE`
on the application role, or a `BEFORE UPDATE OR DELETE` trigger that raises. I didn't build
that here; it's the kind of thing that belongs in a migration reviewed by someone who owns
the database.

---

## Production readiness

A working take-home and a production service are different bars, and the gap was real.
What was added, and the failure each one prevents:

- **Structured logging with request correlation.** `console.log` is not queryable by a
  log aggregator. Every response now carries an `x-request-id` (propagated if the caller
  supplied one), and it appears on every log line for that request — which is what turns
  "it broke around 3pm" into a specific request. Sensitive fields are redacted in the
  logger config, globally, rather than trusting every future call site to remember.
- **Rate limiting on `/auth/login`.** bcrypt slows a single guess, not a million of them
  across a botnet. Successful logins do not consume the budget, so a legitimate user
  cannot lock themselves out.
- **Split liveness and readiness probes.** These are deliberately different:
  `/health/live` never touches the database, because a liveness probe that fails during a
  database outage makes the orchestrator kill and restart every replica — turning a
  recoverable dependency failure into a self-inflicted outage. `/health/ready` does check
  it, so an instance that cannot serve is pulled from the load balancer instead of
  returning 500s.
- **The container no longer runs as root**, ships `dumb-init` so SIGTERM actually reaches
  Node and the graceful-shutdown path runs, and declares a `HEALTHCHECK`.
- **`unhandledRejection` and `uncaughtException` are handled.** A programming error
  leaves the process in an unknown state; logging and exiting for a clean restart is
  safer than serving requests from possibly-corrupted state.
- **Shutdown closes idle keep-alive sockets.** `server.close()` alone can stall until a
  client happens to disconnect.

The one that was an actual bug, not a hardening gap: **the compose config re-ran the seed
on every API start, and the seed truncates.** Restarting the API silently destroyed
everything entered since the container came up. The seed now skips a non-empty database
unless explicitly forced, and there is a manual test in the commit history proving data
survives a restart.

- **Deletion is audited.** Equipment deletion used to leave no trace: the row vanished
  with no actor and no timestamp, and the `AuditAction` enum had no `DELETE` to record one
  with even if you wanted to. It now writes a change set — every tracked field moving to
  null — in the same transaction as the delete, and the polymorphic `entityId` is what
  lets that record outlive the row it describes.
- **Only QA may change the asset register.** Any authenticated operator could previously
  create, retire or delete equipment, which decides what the whole plant is allowed to log
  against. Reading it stays open, because an operator has to pick equipment to log a
  cleaning against.
- **The API refuses to start with a published secret.** `JWT_SECRET` length was the only
  check, and `dev-only-secret-change-me` is 25 characters — long enough to pass, and
  printed in `.env.example` and defaulted in `docker-compose.yml` while the stack ran with
  `NODE_ENV=production`. Since a validly-signed token's claims are trusted as-is, that was
  a forgeable QA identity for anyone who had read the repo. Compose now has no default and
  the config rejects the known values in production.
- **`cleanedAt` cannot be in the future.** The rule existed only in the web form, and a
  client is not a guard.
- **Static assets are cached correctly.** nginx served `index.html` with default caching,
  so a returning visitor could hold a stale document naming asset hashes that no longer
  exist after a deploy — a white screen with 404s. Hashed assets are now `immutable`,
  `index.html` is `no-cache`.

Still not addressed, and honestly so: rate limiting is per-process memory and needs Redis
behind more than one instance; there is no metrics endpoint or tracing; and there is no
caching layer.

Two ordering details that are stated rather than solved. Change sets sharing a single
millisecond are tie-broken on `changeSetId`, which is arbitrary but *stable* — the same
history cannot render in a different order on refresh, and the row lock serialises writes
to one record anyway. A monotonic sequence column would make it chronological; it is not
worth a `BigInt` on every audit row at this size. And `AuditEntry.changedAt` comes from
application clocks, so multiple API instances could interleave slightly under clock skew.

## SOLID, and where I stopped

`docs/ARCHITECTURE.md` maps each principle to the specific place it shows up. The short
version: services depend on interfaces in `src/shared/ports.ts`, the Prisma adapter is the
only file that knows the ORM exists, and `src/container.ts` is the one place that wires
them together.

The payoff is not theoretical — **57 of the 121 API tests run with no database**, because
the services *and now the whole HTTP stack* can be driven by in-memory fakes. That let the
integration suite narrow to what genuinely needs Postgres: the keyset query, the row lock,
and transactional rollback.

The one place the claim did not hold was the controllers, which imported the `services`
singleton from `container.ts` — a service locator pointing the dependency straight at the
composition root, and the reason no HTTP-level test could run without Postgres. Services
are now passed into `createApp`, through the router factories, into each controller.

What I deliberately did **not** do, because the brief asks for code that avoids
over-engineering: no DI container, no abstract factories, no interface-per-class. An
abstraction with one implementation and no second caller is indirection, not design. The
line I drew: invert a dependency when it removes real coupling or unlocks a real test;
otherwise leave the concrete call in place.

## Stack notes

**Prisma over raw SQL.** Migrations, generated types and `$transaction` out of the box, and
the interesting logic — the diff — stays in plain application code that unit-tests in
milliseconds without a database. The one place Prisma couldn't express what I wanted was the
row-value comparison for the keyset query, noted above.

**Version pins that are load-bearing**, both discovered the hard way:

- `prisma` and `@prisma/client` are pinned to **6.19.3**. npm's `latest` dist-tag for
  `prisma` is currently an **8.0.0 release candidate** while `@prisma/client@latest`
  resolves to 7.x, so an unpinned `npm i prisma @prisma/client` installs mismatched majors
  and fails at generate time.
- `vitest` is pinned to **4.1.11**. Vitest 5 requires Node ≥ 22.12; this was built on Node
  20. Similarly `jsdom` is on 28 and `@testing-library/jest-dom` on 6.x — the current
  majors of both require Node 22+.

**No `asyncHandler` wrapper.** Express 5 forwards rejected promises from handlers to the
error middleware natively. Anyone expecting the Express 4 `catchAsync` idiom will notice its
absence; it isn't an oversight.

**Tailwind 4** is a Vite plugin, not a PostCSS pipeline — hence no `tailwind.config.js` and
no `postcss.config.js`.

**No component library.** The dialog and the searchable people picker are both hand-written.
The dialog moves focus in on open, traps Tab, closes on Escape and restores focus to its
trigger. The picker follows the ARIA combobox pattern: `aria-activedescendant` tracks the
highlighted option so DOM focus stays on the input and typing keeps working, arrows wrap at
both ends, Enter commits, Escape closes without committing, and blurring reverts the typed
query so the visible text can never disagree with the value actually held. Its Escape
handler stops propagation, so closing the dropdown does not also close the surrounding
dialog.

A production app should use a well-tested primitive (Radix, React Aria) because there are
more edge cases here than are worth re-implementing — but a generated component library
would have meant a lot of code in the diff I didn't write, and the brief asks that I be
able to explain every line.

The picker filters client-side over an already-fetched list, and `GET /users` caps at 50.
For a directory larger than that, the filter should move to a debounced server-side query —
the endpoint already accepts `?q=`, so it is a hook change rather than a redesign.

**Front-end performance.** The bundle was a single 448 kB chunk, so a visitor hitting the
login page downloaded the entire application. Routes behind the auth gate are now
`React.lazy`-split and dependencies are chunked separately from application code, which
takes the initial payload to ~318 kB (~104 kB gzipped) and means shipping a fix no longer
invalidates the framework bundle in every user's cache. Table rows are memoised on stable
callbacks, so expanding one row's audit trail no longer re-renders all of them — each row
owns a query hook, so that waste scales with page size.

Not done: virtualization (ten rows at a time does not need it) and prefetch-on-hover.

**No global store.** Server state is TanStack Query; the status filter is URL state so a
filtered view is shareable and survives a refresh; everything else is local. Reaching for
Redux here would have been solving a problem I don't have.

**Timestamps render through a fixed `Intl.DateTimeFormat` with an explicit UTC timezone.**
`toLocaleString()` with an ambient zone renders differently on my machine, in CI and in a
test assertion — for a regulated record that's a correctness problem, not a cosmetic one.

---

## What I deliberately left out

Roughly in the order I'd add them next.

- **Refresh tokens.** A short-lived access token held in memory, and re-login when it
  expires. In memory rather than `localStorage` because a token in `localStorage` is
  readable by any injected script. Two costs, both real: a page refresh logs you out, and
  a session longer than `JWT_EXPIRES_IN` (15m) ends mid-task — the 401 interceptor sends
  the user to the login screen, and an unsaved form goes with it. The production shape is
  an `HttpOnly` refresh cookie with rotation, plus a 401 interceptor that silently retries
  once; `AuthProvider` already takes an `initialUser` so a `GET /auth/me` hydration step
  has somewhere to land.
- **Optimistic concurrency** on record updates (see above).
- **Database-enforced append-only audit** (`REVOKE` or a trigger).
- **Roles beyond `operator` and `qa`**, and permissions finer than a five-line
  `requireRole`. Related and deliberate rather than overlooked: any operator may edit any
  *pending* cleaning record, not only their own. `cleanedBy` records who did the work and
  the audit actor records who changed the row, so an edit by a colleague is fully
  attributed rather than anonymous — and on a shift handover that is usually what you
  want. Restricting it to the author (or to the author plus QA) is a one-line guard in
  `applyChange` if the process calls for it; it is a policy choice, so it is stated here
  instead of being assumed. Verification is already role-gated, which is the control that
  actually matters: nobody can sign off their own work.
- **OpenAPI generation** from the Zod schemas. The schemas are already the single source of
  truth, so this is mostly wiring.
- **Reverse keyset pagination** (`prevCursor`), unnecessary given the "Load more" UI.
- **Optimistic UI updates and prefetch-on-hover.** The mutations here have real
  consequences, so waiting for confirmation is the right default.
- **List virtualization.** Ten rows at a time doesn't need it.
- **Browser E2E (Playwright).** The supertest suite covers the API contract, and the
  component tests cover the wiring; a browser runner is a lot of setup for the remaining
  margin at this size.

## What I'd change with more time

- **The audit history endpoint isn't paginated** — it takes a `limit` (default 100, max
  200) and returns the most recent change sets, plus `meta.hasMore` so a caller can tell
  a capped trail from a complete one. That's fine for a record edited a handful of times,
  and wrong for one edited a thousand times. It should use the same cursor helper the
  record list uses (which is now parameterised over its sort column, so it can be); I'd
  rather ship it honestly capped than half-paginated.

  Worth stating because it was a bug rather than a limitation: `limit` used to count
  *rows*, and the table stores one row per changed field. A creation writes six rows, so
  `?limit=3` returned a single change set holding three of its six fields, with nothing
  marking the result as partial — an auditor read a complete-looking CREATE that was
  missing half of what happened. It now counts change sets and never returns a fragment
  of one.
- **`AuditEntry.entityId` has no foreign key**, because it's polymorphic across
  `CleaningRecord` and `Equipment`. That is also what lets a DELETE change set outlive
  the row it describes, which is the point of recording one. That's the standard trade-off for a single generic
  audit table, but it does mean referential integrity there is enforced by the application
  rather than the database. A per-entity audit table would fix it at the cost of
  duplicating the whole mechanism per entity.
- **The seed is idempotent by truncation**, which is right for a demo and wrong for
  anything else.
- **Equipment has no server-side pagination or search.** It's a bounded reference list
  today, and the UI filters by status only. Once it outgrows one screen it should use the
  same cursor helper the cleaning records use.
- **There is no UI for managing users**, so the "cleaned by" picker is limited to seeded
  accounts. Adding one is ordinary CRUD over an endpoint that already exists.
