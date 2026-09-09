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

/** Value for a datetime-local input, which expects local-naive "YYYY-MM-DDTHH:mm". */
export const toDateTimeLocal = (iso: string): string => {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

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
