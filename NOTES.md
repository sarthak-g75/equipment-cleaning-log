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

**`cleanedBy` and the audit actor are different people.** The operator who physically
cleaned the vessel often has no login; the person recording or verifying it does. So
`cleanedBy` is a plain string (name/badge) and the audit actor is always the authenticated
user from the JWT. Conflating them would be wrong in a regulated context. The form defaults
`cleanedBy` to the signed-in user's name, so the common case is still one less field to type.

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

**No component library.** The dialog is hand-written: focus moves in on open, Tab is
trapped, Escape closes, focus returns to the trigger. A production app should use a
well-tested primitive (Radix, React Aria) because there are more edge cases here than are
worth re-implementing — but a generated component library would have meant a lot of code in
the diff I didn't write, and the brief asks that I be able to explain every line.

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
  readable by any injected script; the cost is that a page refresh logs you out. The
  production shape is an `HttpOnly` refresh cookie with rotation, plus a 401 interceptor
  that silently retries once.
- **Optimistic concurrency** on record updates (see above).
- **Database-enforced append-only audit** (`REVOKE` or a trigger).
- **Roles beyond `operator` and `qa`**, and permissions finer than a five-line
  `requireRole`.
- **Structured logging** with request-id correlation, and rate limiting on `/auth/login`.
  Both matter in production; neither is visible in a take-home.
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
  200) and returns the most recent change sets. That's fine for a record edited a handful
  of times, and wrong for one edited a thousand times. It should use the same cursor
  helper the record list uses; I'd rather ship it honestly capped than half-paginated.
- **`AuditEntry.entityId` has no foreign key**, because it's polymorphic across
  `CleaningRecord` and `Equipment`. That's the standard trade-off for a single generic
  audit table, but it does mean referential integrity there is enforced by the application
  rather than the database. A per-entity audit table would fix it at the cost of
  duplicating the whole mechanism per entity.
- **Equipment create/update has no UI** — the API supports full CRUD and it's covered by
  tests, but the front-end only browses equipment and manages cleaning records against it.
  I spent the front-end budget on the parts the brief actually scores (paginated records,
  the form, the audit trail) rather than spreading it thin.
- **The seed is idempotent by truncation**, which is right for a demo and wrong for
  anything else.
