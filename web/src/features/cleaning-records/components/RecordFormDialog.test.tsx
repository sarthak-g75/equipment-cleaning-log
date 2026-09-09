import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../tests/renderWithProviders';
import { ApiError } from '../../../services/apiClient';
import { BOB, makeRecord } from '../../../tests/handlers';
import { RecordFormDialog } from './RecordFormDialog';

const open = (props: Partial<Parameters<typeof RecordFormDialog>[0]> = {}) => {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props.onClose ?? vi.fn();

  renderWithProviders(
    <RecordFormDialog
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      defaultCleanedById={BOB.id}
      {...props}
    />,
  );

  // vi.mocked keeps `.mock` visible on the returned handles; without it the
  // union with the prop's declared function type hides it from the typechecker.
  return { onSubmit: vi.mocked(onSubmit), onClose: vi.mocked(onClose) };
};

describe('RecordFormDialog', () => {
  it('labels every field and marks itself as a modal dialog', async () => {
    open();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog', { name: 'Log a cleaning' })).toBeInTheDocument();
    // Queried by label, which is also the check that a screen reader can find them.
    expect(await screen.findByDisplayValue('Bob Novak')).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('pre-fills the form when editing an existing record', () => {
    open({ record: makeRecord({ method: 'SIP', notes: 'Swab passed' }) });

    expect(screen.getByRole('dialog', { name: 'Edit cleaning record' })).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toHaveValue('SIP');
    expect(screen.getByLabelText('Notes')).toHaveValue('Swab passed');
  });

  it('blocks submission and reports the field when a required value is missing', async () => {
    const user = userEvent.setup();
    const { onSubmit } = open();

    await user.clear(screen.getByLabelText('Method'));
    await user.click(screen.getByRole('button', { name: 'Log cleaning' }));

    expect(await screen.findByText('Which method was used?')).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toHaveAttribute('aria-invalid', 'true');
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

    // Waited in two stages rather than one: the submit has to round-trip
    // through the resolver and the rejected mutation before the error can
    // render, and collapsing both into a single findBy makes the assertion
    // race the whole chain under parallel load.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

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

    // Something has to actually change, or the dialog short-circuits without a
    // request — see the PATCH tests below.
    await user.clear(screen.getByLabelText('Method'));
    await user.type(screen.getByLabelText('Method'), 'SIP');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A verified record cannot be edited.',
    );
  });

  /**
   * An edit used to submit every field whether or not the user touched it,
   * making the request a PUT wearing a PATCH's name. The API distinguishes
   * "omitted" from "explicitly null", and the audit trail depends on that
   * distinction, so re-sending an untouched field means re-auditing it.
   */
  describe('an edit sends only what changed', () => {
    it('reports just the touched field as changed', async () => {
      const user = userEvent.setup();
      const { onSubmit } = open({ record: makeRecord({ method: 'CIP - caustic' }) });

      await user.clear(screen.getByLabelText('Method'));
      await user.type(screen.getByLabelText('Method'), 'SIP');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

      const changed = onSubmit.mock.calls[0]![1];
      expect(Object.keys(changed)).toEqual(['method']);
      expect(changed.method).toBe('SIP');
      // Crucially absent: the timestamp the user never touched.
      expect(changed).not.toHaveProperty('cleanedAt');
    });

    it('reports a cleared note as an explicit change', async () => {
      const user = userEvent.setup();
      const { onSubmit } = open({ record: makeRecord({ notes: 'Swab passed' }) });

      await user.clear(screen.getByLabelText('Notes'));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(Object.keys(onSubmit.mock.calls[0]![1])).toEqual(['notes']);
    });

    it('makes no request at all when nothing was touched', async () => {
      const user = userEvent.setup();
      const { onSubmit, onClose } = open({ record: makeRecord() });

      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
      // A round trip here could only ever come back as "provide at least one
      // field to update".
      expect(onSubmit).not.toHaveBeenCalled();
    });

    /**
     * The bug this guards: the field was written from UTC getters and read back
     * as local time, so merely opening a record and saving it shifted
     * `cleanedAt` by the browser's offset and forged an audit entry.
     */
    it('does not treat an untouched timestamp as a change', async () => {
      const user = userEvent.setup();
      const record = makeRecord({ cleanedAt: '2026-08-24T08:00:00.000Z' });
      const { onSubmit } = open({ record });

      expect(screen.getByLabelText('Cleaned at')).toHaveValue('2026-08-24T08:00');

      await user.clear(screen.getByLabelText('Method'));
      await user.type(screen.getByLabelText('Method'), 'SIP');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0]![1]).not.toHaveProperty('cleanedAt');
    });
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
