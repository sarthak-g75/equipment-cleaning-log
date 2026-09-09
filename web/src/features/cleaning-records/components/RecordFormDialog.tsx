import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { Field, inputClass } from '../../../components/Field';
import { Combobox, type ComboboxOption } from '../../../components/Combobox';
import { useUsers } from '../../users/hooks/useUsers';
import { ApiError } from '../../../services/apiClient';
import { toUtcDateTimeLocal } from '../../../utils/format';
import { recordSchema, type RecordFormValues } from '../validators/recordSchema';
import type { CleaningRecord, UserSummary } from '../../../types/api';

interface RecordFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * `changed` holds only the fields the user actually touched, so an edit sends
   * a real PATCH. Sending every field on every save made this a PUT in
   * disguise: the server's "an omitted field is not a change" semantics were
   * never exercised from the UI, which is part of why a timestamp being
   * silently rewritten on every save went unnoticed.
   */
  onSubmit: (values: RecordFormValues, changed: Partial<RecordFormValues>) => Promise<unknown>;
  /** Present when editing; absent when creating. */
  record?: CleaningRecord | undefined;
  /** The signed-in user, pre-selected as the likeliest cleaner. */
  defaultCleanedById: string;
  /** Shown in the picker before any search runs, so the selection has a label. */
  defaultCleanedBy?: UserSummary | undefined;
}

const emptyValues = (cleanedById: string): RecordFormValues => ({
  cleanedById,
  cleanedAt: toUtcDateTimeLocal(new Date().toISOString()),
  method: '',
  notes: '',
});

export function RecordFormDialog({
  isOpen,
  onClose,
  onSubmit,
  record,
  defaultCleanedById,
  defaultCleanedBy,
}: RecordFormDialogProps) {
  const isEditing = record !== undefined;

  // The picker filters on the server, so the query it types lives here.
  const [search, setSearch] = useState('');
  const users = useUsers(search);

  /**
   * The already-selected person, kept in the list even when the current search
   * does not match them. Without this the input would render blank whenever the
   * server's results happen not to include the current value — the field would
   * look empty while holding a perfectly good id.
   */
  const selectedOption = useMemo<ComboboxOption | null>(() => {
    const source = record?.cleanedBy ?? defaultCleanedBy;
    if (!source) return null;
    return { value: source.id, label: source.name, hint: source.email };
  }, [record?.cleanedBy, defaultCleanedBy]);

  const userOptions = useMemo<ComboboxOption[]>(() => {
    const fetched = (users.data ?? []).map((u) => ({
      value: u.id,
      label: u.name,
      hint: u.email,
    }));

    if (!selectedOption || fetched.some((o) => o.value === selectedOption.value)) return fetched;
    return [selectedOption, ...fetched];
  }, [users.data, selectedOption]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<RecordFormValues>({
    resolver: zodResolver(recordSchema),
    defaultValues: emptyValues(defaultCleanedById),
  });

  // Re-seed the form whenever the dialog opens for a different record. Without
  // this the previous record's values persist, because RHF keeps its state.
  useEffect(() => {
    if (!isOpen) return;
    // The picker's own query is cleared by the Combobox when it opens and when
    // it closes, so there is nothing to reset here — and resetting state from
    // inside an effect is the render loop this rule exists to prevent. Until
    // the user focuses the picker, `selectedOption` keeps the field labelled.
    reset(
      record
        ? {
            cleanedById: record.cleanedById,
            cleanedAt: toUtcDateTimeLocal(record.cleanedAt),
            method: record.method,
            notes: record.notes ?? '',
          }
        : emptyValues(defaultCleanedById),
    );
  }, [isOpen, record, defaultCleanedById, reset]);

  const submit = handleSubmit(async (values) => {
    // Only what the user touched. `dirtyFields` is RHF's own comparison against
    // the values the form was reset with, so an untouched timestamp is simply
    // absent from the request rather than being re-sent and re-audited.
    const changed = Object.fromEntries(
      (Object.keys(values) as (keyof RecordFormValues)[])
        .filter((key) => dirtyFields[key])
        .map((key) => [key, values[key]]),
    ) as Partial<RecordFormValues>;

    // Nothing to save. Closing beats a round trip that can only come back as
    // "provide at least one field to update".
    if (isEditing && Object.keys(changed).length === 0) {
      onClose();
      return;
    }

    try {
      await onSubmit(values, changed);
      onClose();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setError('root', { message: 'Something went wrong. Please try again.' });
        return;
      }

      // Map the server's field-level details back onto the offending inputs, so
      // a rule only the server knows about still lands next to the right field
      // rather than in a generic banner.
      const fieldErrors = error.fieldErrors();
      const known: (keyof RecordFormValues)[] = ['cleanedById', 'cleanedAt', 'method', 'notes'];
      let matched = false;

      for (const field of known) {
        const message = fieldErrors[field];
        if (message) {
          setError(field, { message });
          matched = true;
        }
      }

      if (!matched) setError('root', { message: error.message });
    }
  });

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit cleaning record' : 'Log a cleaning'}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label="Cleaned by"
          htmlFor="cleanedById"
          error={errors.cleanedById?.message ?? (users.isError ? 'Could not load users.' : undefined)}
          hint="Type to search by name or email."
        >
          {/* Controller, not register: the combobox is not a native input, so
              its value/onChange have to be wired explicitly. */}
          <Controller
            control={control}
            name="cleanedById"
            render={({ field }) => (
              <Combobox
                id="cleanedById"
                options={userOptions}
                value={field.value ?? null}
                onChange={field.onChange}
                // Filtering happens on the server, so the whole directory is
                // reachable rather than just the first page of it.
                onSearchChange={setSearch}
                isLoading={users.isPending}
                disabled={users.isError}
                placeholder="Search people…"
                emptyMessage="No matching people"
                aria-invalid={Boolean(errors.cleanedById)}
                aria-describedby={errors.cleanedById ? 'cleanedById-error' : 'cleanedById-hint'}
              />
            )}
          />
        </Field>

        <Field
          label="Cleaned at"
          htmlFor="cleanedAt"
          error={errors.cleanedAt?.message}
          hint="Entered and stored in UTC."
        >
          <input
            {...register('cleanedAt')}
            id="cleanedAt"
            type="datetime-local"
            className={inputClass}
            aria-invalid={Boolean(errors.cleanedAt)}
            aria-describedby={errors.cleanedAt ? 'cleanedAt-error' : 'cleanedAt-hint'}
          />
        </Field>

        <Field label="Method" htmlFor="method" error={errors.method?.message}>
          <input
            {...register('method')}
            id="method"
            className={inputClass}
            placeholder="CIP - caustic"
            aria-invalid={Boolean(errors.method)}
            aria-describedby={errors.method ? 'method-error' : undefined}
          />
        </Field>

        <Field
          label="Notes"
          htmlFor="notes"
          error={errors.notes?.message}
          hint="Optional. Clearing this field is recorded in the audit trail."
        >
          <textarea
            {...register('notes')}
            id="notes"
            rows={3}
            className={inputClass}
            aria-invalid={Boolean(errors.notes)}
            aria-describedby={errors.notes ? 'notes-error' : 'notes-hint'}
          />
        </Field>

        {errors.root && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-xs font-medium text-red-800">
            {errors.root.message}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Log cleaning'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
