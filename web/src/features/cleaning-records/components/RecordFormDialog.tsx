import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { Field, inputClass } from '../../../components/Field';
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
  defaultCleanedBy: string;
}

const emptyValues = (cleanedBy: string): RecordFormValues => ({
  cleanedBy,
  cleanedAt: toDateTimeLocal(new Date().toISOString()),
  method: '',
  notes: '',
});

export function RecordFormDialog({
  isOpen,
  onClose,
  onSubmit,
  record,
  defaultCleanedBy,
}: RecordFormDialogProps) {
  const isEditing = record !== undefined;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RecordFormValues>({
    resolver: zodResolver(recordSchema),
    defaultValues: emptyValues(defaultCleanedBy),
  });

  // Re-seed the form whenever the dialog opens for a different record. Without
  // this the previous record's values persist, because RHF keeps its state.
  useEffect(() => {
    if (!isOpen) return;
    reset(
      record
        ? {
            cleanedBy: record.cleanedBy,
            cleanedAt: toDateTimeLocal(record.cleanedAt),
            method: record.method,
            notes: record.notes ?? '',
          }
        : emptyValues(defaultCleanedBy),
    );
  }, [isOpen, record, defaultCleanedBy, reset]);

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
      const known: (keyof RecordFormValues)[] = ['cleanedBy', 'cleanedAt', 'method', 'notes'];
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
        <Field label="Cleaned by" htmlFor="cleanedBy" error={errors.cleanedBy?.message}>
          <input
            {...register('cleanedBy')}
            id="cleanedBy"
            className={inputClass}
            aria-invalid={Boolean(errors.cleanedBy)}
            aria-describedby={errors.cleanedBy ? 'cleanedBy-error' : undefined}
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
