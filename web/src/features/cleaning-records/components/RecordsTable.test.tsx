import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../../tests/server';
import { API, makeRecord } from '../../../tests/handlers';
import { renderWithProviders } from '../../../tests/renderWithProviders';
import { RecordsTable } from './RecordsTable';

const records = [
  makeRecord({ id: '11111111-1111-4111-8111-111111111111', method: 'CIP - caustic' }),
  makeRecord({
    id: '22222222-2222-4222-8222-222222222222',
    method: 'SIP',
    status: 'verified',
    notes: null,
  }),
];

const noop = () => {};

describe('RecordsTable', () => {
  it('renders a row per record, showing an em-dash for absent notes', () => {
    renderWithProviders(
      <RecordsTable
        records={records}
        canVerify={false}
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    const rows = screen.getAllByRole('row');
    // One header row plus one row per record.
    expect(rows).toHaveLength(3);
    expect(screen.getByText('CIP - caustic')).toBeInTheDocument();
    expect(screen.getByText('Swab passed')).toBeInTheDocument();
    // "no notes" must be visibly distinct from an empty cell.
    expect(within(rows[2]!).getByText('—')).toBeInTheDocument();
  });

  it('does not offer Edit or Verify on a record that has been verified', () => {
    renderWithProviders(
      <RecordsTable
        records={records}
        canVerify
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    const [, pendingRow, verifiedRow] = screen.getAllByRole('row');

    // A verified record is a signed-off document; the API rejects edits to it,
    // so offering the button would be a dead end.
    expect(within(pendingRow!).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(pendingRow!).getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(within(verifiedRow!).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(verifiedRow!).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
  });

  it('hides Verify from a user without the QA role', () => {
    renderWithProviders(
      <RecordsTable
        records={records}
        canVerify={false}
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
  });

  it('loads the audit trail only when a row is expanded, and renders old to new', async () => {
    const auditRequests: string[] = [];
    server.use(
      http.get(`${API}/cleaning-records/:id/audit`, ({ params }) => {
        auditRequests.push(String(params.id));
        return HttpResponse.json({
          data: [
            {
              changeSetId: 'cs-2',
              action: 'UPDATE',
              changedAt: '2026-08-25T10:00:00.000Z',
              actor: { id: 'u1', name: 'Alice Chen' },
              changes: [
                { field: 'method', oldValue: 'CIP - caustic', newValue: 'SIP' },
                { field: 'notes', oldValue: 'Swab passed', newValue: null },
              ],
            },
          ],
          meta: { limit: 100, hasMore: false },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <RecordsTable
        records={records}
        canVerify={false}
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    // Nothing is fetched until the user asks for the history.
    expect(auditRequests).toEqual([]);

    const historyButton = screen.getAllByRole('button', { name: 'History' })[0]!;
    expect(historyButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(historyButton);

    expect(await screen.findByText('Alice Chen')).toBeInTheDocument();
    expect(historyButton).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(auditRequests).toEqual([records[0]!.id]));

    // Scoped to the trail: these values also appear in the table row itself, so
    // an unscoped query would pass even if the trail rendered nothing.
    const trail = within(document.getElementById(`audit-${records[0]!.id}`)!);

    expect(trail.getByText('Method')).toBeInTheDocument();
    expect(trail.getByText('CIP - caustic')).toBeInTheDocument();
    expect(trail.getByText('SIP')).toBeInTheDocument();
    expect(trail.getByText('Swab passed')).toBeInTheDocument();
    // A cleared field reads as an explicit "no value", not as a blank cell.
    expect(trail.getByText('—')).toBeInTheDocument();
  });

  it('surfaces a retry when the audit trail fails to load', async () => {
    server.use(
      http.get(`${API}/cleaning-records/:id/audit`, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom' } },
          { status: 500 },
        ),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    renderWithProviders(
      <RecordsTable
        records={[records[0]!]}
        canVerify={false}
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'History' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the audit trail.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  /**
   * The history endpoint is capped, not paginated. If the UI renders a
   * truncated trail without saying so, an auditor reads the newest slice as the
   * whole history — the precise failure this feature exists to prevent.
   */
  it('says so when the audit trail is truncated', async () => {
    server.use(
      http.get(`${API}/cleaning-records/:id/audit`, () =>
        HttpResponse.json({
          data: [
            {
              changeSetId: 'cs-1',
              action: 'UPDATE',
              changedAt: '2026-08-25T10:00:00.000Z',
              actor: { id: 'u1', name: 'Alice Chen' },
              changes: [{ field: 'method', oldValue: 'CIP - caustic', newValue: 'SIP' }],
            },
          ],
          meta: { limit: 1, hasMore: true },
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <RecordsTable
        records={records}
        canVerify={false}
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: 'History' })[0]!);

    expect(
      await screen.findByText(/Showing the 1 most recent changes\. Older changes are not shown\./),
    ).toBeInTheDocument();
  });

  it('does not claim truncation when the trail is complete', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/cleaning-records/:id/audit`, () =>
        HttpResponse.json({
          data: [
            {
              changeSetId: 'cs-1',
              action: 'CREATE',
              changedAt: '2026-08-24T08:05:00.000Z',
              actor: { id: 'u1', name: 'Alice Chen' },
              changes: [{ field: 'method', oldValue: null, newValue: 'CIP - caustic' }],
            },
          ],
          meta: { limit: 100, hasMore: false },
        }),
      ),
    );

    renderWithProviders(
      <RecordsTable
        records={records}
        canVerify={false}
        onEdit={noop}
        onVerify={noop}
        verifyingId={null}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: 'History' })[0]!);
    await screen.findByText('Alice Chen');

    expect(screen.queryByText(/Older changes are not shown/)).not.toBeInTheDocument();
  });
});
