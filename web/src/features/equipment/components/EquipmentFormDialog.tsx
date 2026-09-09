import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { Field, inputClass } from '../../../components/Field';
import { ApiError } from '../../../services/apiClient';
import { equipmentSchema, type EquipmentFormValues } from '../validators/equipmentSchema';
import type { Equipment } from '../../../types/api';

interface EquipmentFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: EquipmentFormValues) => Promise<unknown>;
  /** Present when editing; absent when creating. */
  equipment?: Equipment | undefined;
}

const EMPTY: EquipmentFormValues = { name: '', code: '', status: 'active' };

export function EquipmentFormDialog({
  isOpen,
  onClose,
  onSubmit,
  equipment,
}: EquipmentFormDialogProps) {
  const isEditing = equipment !== undefined;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EquipmentFormValues>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!isOpen) return;
    reset(
      equipment
        ? { name: equipment.name, code: equipment.code, status: equipment.status }
        : EMPTY,
    );
  }, [isOpen, equipment, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      onClose();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setError('root', { message: 'Something went wrong. Please try again.' });
        return;
      }

      // A duplicate code is the one error a user will actually hit here, and it
      // belongs on the code field rather than in a banner.
      if (error.code === 'DUPLICATE_VALUE') {
        setError('code', { message: 'That code is already in use.' });
        return;
      }

      const fieldErrors = error.fieldErrors();
      let matched = false;
      for (const field of ['name', 'code', 'status'] as const) {
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
      title={isEditing ? 'Edit equipment' : 'Add equipment'}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="equipment-name" error={errors.name?.message}>
          <input
            {...register('name')}
            id="equipment-name"
            className={inputClass}
            placeholder="Bioreactor 101"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'equipment-name-error' : undefined}
          />
        </Field>

        <Field
          label="Code"
          htmlFor="equipment-code"
          error={errors.code?.message}
          hint="Asset label code, e.g. BR-101. Stored uppercase."
        >
          <input
            {...register('code')}
            id="equipment-code"
            className={`${inputClass} uppercase`}
            placeholder="BR-101"
            aria-invalid={Boolean(errors.code)}
            aria-describedby={errors.code ? 'equipment-code-error' : 'equipment-code-hint'}
          />
        </Field>

        <Field
          label="Status"
          htmlFor="equipment-status"
          error={errors.status?.message}
          hint="Retired equipment cannot have new cleanings logged against it."
        >
          <select
            {...register('status')}
            id="equipment-status"
            className={inputClass}
            aria-invalid={Boolean(errors.status)}
            aria-describedby={errors.status ? 'equipment-status-error' : 'equipment-status-hint'}
          >
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
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
            {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Add equipment'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
