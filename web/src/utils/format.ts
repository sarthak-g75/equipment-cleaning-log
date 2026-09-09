/**
 * A fixed formatter with an explicit timezone. `toLocaleString()` with an
 * ambient zone renders differently on the reviewer's machine, in CI and in a
 * test assertion — for a regulated record that is a correctness problem, not a
 * cosmetic one. UTC is the honest choice for a manufacturing log spanning sites.
 */
const FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export const formatTimestamp = (iso: string): string => `${FORMATTER.format(new Date(iso))} UTC`;

/**
 * `cleanedAt` is entered, displayed and stored in UTC — the whole app reads
 * timestamps in UTC, and the form says so next to the field.
 *
 * A `datetime-local` input holds a timezone-less wall clock, so *something* has
 * to decide which zone that wall clock belongs to, and the two directions have
 * to agree. They did not: the value was built from UTC getters and read back
 * with `new Date(value)`, which the language interprets as LOCAL time. The two
 * halves disagreed by the browser's offset, so opening a record and saving it
 * without touching the timestamp moved `cleanedAt` — and the audit trail
 * recorded a change the user never made. On this machine (UTC+5:30) 08:00Z came
 * back as 02:30Z.
 *
 * Worse on the create path: the prefill was the current UTC wall clock read
 * back as local, i.e. `now - offset`. West of UTC that lands in the *future*,
 * and the form's own "cannot be logged in the future" rule then rejected the
 * value it had just filled in. The dialog was unusable across the Americas.
 *
 * These two functions are exact inverses, and there is a test that pins a
 * non-UTC timezone and proves it.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant -> the value a `datetime-local` input expects, read as UTC. */
export const toUtcDateTimeLocal = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/**
 * A `datetime-local` value -> the ISO instant it denotes.
 *
 * The `Z` is the whole point: it pins the wall clock to UTC instead of letting
 * the runtime apply the viewer's offset.
 */
export const utcDateTimeLocalToIso = (value: string): string =>
  new Date(`${value}Z`).toISOString();

/** Whether a `datetime-local` value parses at all, under the UTC convention. */
export const isValidUtcDateTimeLocal = (value: string): boolean =>
  !Number.isNaN(Date.parse(`${value}Z`));

/** The instant a `datetime-local` value denotes, in epoch milliseconds. */
export const utcDateTimeLocalToMillis = (value: string): number => Date.parse(`${value}Z`);

const FIELD_LABELS: Record<string, string> = {
  equipmentId: 'Equipment',
  cleanedById: 'Cleaned by',
  cleanedBy: 'Cleaned by',
  cleanedAt: 'Cleaned at',
  method: 'Method',
  notes: 'Notes',
  status: 'Status',
  name: 'Name',
  code: 'Code',
};

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

/**
 * Renders an audit value, keeping "no value" visually distinct from a blank cell.
 * `label` is the server-resolved display form for reference fields — preferred
 * when present so the trail shows a name rather than a UUID.
 */
export const displayAuditValue = (
  value: string | null,
  field: string,
  label?: string | null,
): string => {
  if (value === null) return '—';
  if (label) return label;
  if (field === 'cleanedAt') return formatTimestamp(value);
  return value;
};
