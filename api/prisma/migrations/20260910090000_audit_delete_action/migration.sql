-- Deleting an audited entity has to be recordable.
--
-- Without a DELETE action the trail simply loses the row: the asset disappears
-- with no actor and no timestamp, which is the one gap a system built around an
-- audit trail cannot have. Equipment deletion now writes a change set moving
-- every tracked field to null.
--
-- `ADD VALUE` is safe inside migrate's transaction on PostgreSQL 12+ as long as
-- the new label is not itself used in the same transaction, which it is not.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETE';
