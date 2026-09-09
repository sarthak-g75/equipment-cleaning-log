import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { Field, inputClass } from '../../../components/Field';
import { Combobox, type ComboboxOption } from '../../../components/Combobox';
import { useUsers } from '../../users/hooks/useUsers';
import { ApiError } from '../../../services/apiClient';
import { toDateTimeLocal } from '../../../utils/format';
import { recordSchema, type RecordFormValues } from '../validators/recordSchema';
import type { CleaningRecord } from '../../../types/api';

interface RecordFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: RecordFormValues) => Promise<unknown>;
  /** Present when editing; absent when creating. */
  record?: CleaningRecord | undefined;
  /** The signed-in user, pre-selected as the likeliest cleaner. */
  defaultCleanedById: string;
}

const emptyValues = (cleanedById: string): RecordFormValues => ({
  cleanedById,
  cleanedAt: toDateTimeLocal(new Date().toISOString()),
  method: '',
  notes: '',
});

export function RecordFormDialog({
  isOpen,
  onClose,
  onSubmit,
  record,
  defaultCleanedById,
}: RecordFormDialogProps) {
  const isEditing = record !== undefined;
  const users = useUsers();

  const userOptions = useMemo<ComboboxOption[]>(
    () => (users.data ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.email })),
    [users.data],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RecordFormValues>({
    resolver: zodResolver(recordSchema),
    defaultValues: emptyValues(defaultCleanedById),
  });

  // Re-seed the form whenever the dialog opens for a different record. Without
  // this the previous record's values persist, because RHF keeps its state.
  useEffect(() => {
    if (!isOpen) return;
    reset(
      record
        ? {
            cleanedById: record.cleanedById,
            cleanedAt: toDateTimeLocal(record.cleanedAt),
            method: record.method,
            notes: record.notes ?? '',
          }
        : emptyValues(defaultCleanedById),
    );
  }, [isOpen, record, defaultCleanedById, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
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
