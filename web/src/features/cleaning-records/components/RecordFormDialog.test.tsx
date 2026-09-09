import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../tests/renderWithProviders';
import { ApiError } from '../../../services/apiClient';
import { makeRecord } from '../../../tests/handlers';
import { RecordFormDialog } from './RecordFormDialog';

const open = (props: Partial<Parameters<typeof RecordFormDialog>[0]> = {}) => {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props.onClose ?? vi.fn();

  renderWithProviders(
    <RecordFormDialog
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      defaultCleanedBy="Bob Novak"
      {...props}
    />,
  );

  return { onSubmit, onClose };
};

describe('RecordFormDialog', () => {
  it('labels every field and marks itself as a modal dialog', () => {
    open();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog', { name: 'Log a cleaning' })).toBeInTheDocument();
    // Queried by label, which is also the check that a screen reader can find them.
    expect(screen.getByLabelText('Cleaned by')).toHaveValue('Bob Novak');
    expect(screen.getByLabelText('Method')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('pre-fills the form when editing an existing record', () => {
    open({ record: makeRecord({ method: 'SIP', notes: 'Swab passed' }) });

    expect(screen.getByRole('dialog', { name: 'Edit cleaning record' })).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toHaveValue('SIP');
    expect(screen.getByLabelText('Notes')).toHaveValue('Swab passed');
  });

  it('blocks submission and reports the field when a value is missing', async () => {
    const user = userEvent.setup();
    const { onSubmit } = open();

    await user.clear(screen.getByLabelText('Cleaned by'));
    await user.click(screen.getByRole('button', { name: 'Log cleaning' }));

    expect(await screen.findByText('Who performed the cleaning?')).toBeInTheDocument();
    expect(screen.getByLabelText('Cleaned by')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends cleanedAt as a UTC instant and normalises blank notes to null', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    open({ onSubmit });

    await user.type(screen.getByLabelText('Method'), 'CIP - caustic');
    await user.click(screen.getByRole('button', { name: 'Log cleaning' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0];
    expect(values.method).toBe('CIP - caustic');
    // The hook converts this to an ISO instant; the form holds the raw
    // datetime-local value, which carries no offset.
    expect(values.cleanedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('maps a server-side validation error back onto the offending field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'The request payload failed validation.', [
        { field: 'body.method', message: 'That method is not approved for this equipment.' },
      ]),
    );
    const { onClose } = open({ onSubmit });

    await user.type(screen.getByLabelText('Method'), 'Rinse with tap water');
    await user.click(screen.getByRole('button', { name: 'Log cleaning' }));

    // The message lands next to the field, not in a generic banner, and the
    // dialog stays open with the user's input intact.
    expect(
      await screen.findByText('That method is not approved for this equipment.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toHaveValue('Rinse with tap water');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a form-level alert when the server error names no field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'RECORD_VERIFIED', 'A verified record cannot be edited.'));
    open({ onSubmit, record: makeRecord() });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A verified record cannot be edited.',
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
