-- Turn CleaningRecord.cleanedBy from free text into a relation to User.
--
-- Done as the standard three steps — add nullable, backfill, then enforce —
-- because the column is required and the table already holds rows. Adding it as
-- NOT NULL in one statement cannot work against a non-empty table.

-- 1. Add the column nullable so existing rows survive the DDL.
ALTER TABLE "CleaningRecord" ADD COLUMN "cleanedById" UUID;

-- 2. Backfill by matching the old free-text name against User.name. The legacy
--    values are abbreviated ("B. Novak" for "Bob Novak"), so match on surname
--    plus first initial rather than on equality.
UPDATE "CleaningRecord" cr
SET "cleanedById" = u."id"
FROM "User" u
WHERE cr."cleanedById" IS NULL
  AND lower(split_part(cr."cleanedBy", ' ', 2)) = lower(split_part(u."name", ' ', 2))
  AND lower(left(cr."cleanedBy", 1)) = lower(left(u."name", 1));

-- 3a. Guard the degenerate case: rows to attribute but no users at all to
--     attribute them to. Deleting unattributable cleaning records would destroy
--     audit history, so a clearly-labelled placeholder is created instead. The
--     password hash is deliberately invalid, so the account cannot be logged into.
INSERT INTO "User" ("id", "email", "name", "role", "passwordHash", "createdAt")
SELECT gen_random_uuid(), 'unknown@migrated.invalid', 'Unknown (pre-migration)', 'operator', '!', now()
WHERE EXISTS (SELECT 1 FROM "CleaningRecord" WHERE "cleanedById" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "User");

-- 3b. Anything still unmatched is assigned to the earliest-created user so the
--     column can be made NOT NULL. In a system with real production data this
--     would be a reviewed data-correction task rather than a heuristic — here
--     the only rows that can reach it are seeded demo data.
UPDATE "CleaningRecord"
SET "cleanedById" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
WHERE "cleanedById" IS NULL;

-- 4. Enforce the constraint and drop the old column.
ALTER TABLE "CleaningRecord" ALTER COLUMN "cleanedById" SET NOT NULL;
ALTER TABLE "CleaningRecord" DROP COLUMN "cleanedBy";

ALTER TABLE "CleaningRecord"
  ADD CONSTRAINT "CleaningRecord_cleanedById_fkey"
  FOREIGN KEY ("cleanedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CleaningRecord_cleanedById_idx" ON "CleaningRecord"("cleanedById");

-- Existing AuditEntry rows are deliberately left untouched. They record a
-- 'cleanedBy' field holding a name, which is exactly what was true when those
-- changes were made. Rewriting history to match the new schema is the one thing
-- an audit trail must never do.
