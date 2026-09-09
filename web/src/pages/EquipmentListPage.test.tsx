import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../tests/server';
import { API } from '../tests/handlers';
import { renderWithProviders } from '../tests/renderWithProviders';
import { EquipmentListPage } from './EquipmentListPage';

const equipment = [
  {
    id: 'eq-1',
    name: 'Bioreactor 101',
    code: 'BR-101',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'eq-2',
    name: 'Mixer 520',
    code: 'MX-520',
    status: 'retired',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const listHandler = () => http.get(`${API}/equipment`, () => HttpResponse.json({ data: equipment }));

const renderPage = () => renderWithProviders(<EquipmentListPage />, { route: '/equipment' });

describe('EquipmentListPage', () => {
  it('lists equipment and marks retired items', async () => {
    server.use(listHandler());
    renderPage();

    expect(await screen.findByRole('link', { name: 'Bioreactor 101' })).toHaveAttribute(
      'href',
      '/equipment/eq-1',
    );
    const retiredCard = screen.getByRole('link', { name: 'Mixer 520' }).closest('li')!;
    expect(within(retiredCard).getByText('retired')).toBeInTheDocument();
  });

  it('shows a designed empty state rather than a blank list', async () => {
    server.use(http.get(`${API}/equipment`, () => HttpResponse.json({ data: [] })));
    renderPage();

    expect(await screen.findByText('No equipment yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add equipment' }).length).toBeGreaterThan(0);
  });

  it('offers a retry when the list fails to load', async () => {
    server.use(
      http.get(`${API}/equipment`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { status: 500 }),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load equipment.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('creates equipment and refreshes the list', async () => {
    const posted: unknown[] = [];
    let created = false;

    server.use(
      http.get(`${API}/equipment`, () =>
        HttpResponse.json({
          data: created
            ? [...equipment, { ...equipment[0]!, id: 'eq-3', name: 'Centrifuge 200', code: 'CF-200' }]
            : equipment,
        }),
      ),
      http.post(`${API}/equipment`, async ({ request }) => {
        posted.push(await request.json());
        created = true;
        return HttpResponse.json({ data: { ...equipment[0]!, id: 'eq-3' } }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('link', { name: 'Bioreactor 101' });

    await user.click(screen.getByRole('button', { name: 'Add equipment' }));
    await user.type(screen.getByLabelText('Name'), 'Centrifuge 200');
    // Typed lowercase deliberately: the schema uppercases it before sending.
    await user.type(screen.getByLabelText('Code'), 'cf-200');
    // Scoped to the dialog: the page header carries a button with the same name.
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add equipment' }),
    );

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ name: 'Centrifuge 200', code: 'CF-200', status: 'active' });

    // The list re-fetches on success rather than requiring a manual reload.
    expect(await screen.findByRole('link', { name: 'Centrifuge 200' })).toBeInTheDocument();
  });

  it('puts a duplicate-code conflict on the code field, not in a banner', async () => {
    server.use(
      listHandler(),
      http.post(`${API}/equipment`, () =>
        HttpResponse.json(
          { error: { code: 'DUPLICATE_VALUE', message: 'A record with that code already exists.' } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('link', { name: 'Bioreactor 101' });

    await user.click(screen.getByRole('button', { name: 'Add equipment' }));
    await user.type(screen.getByLabelText('Name'), 'Duplicate');
    await user.type(screen.getByLabelText('Code'), 'BR-101');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add equipment' }));

    expect(await screen.findByText('That code is already in use.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
    // The dialog stays open with the user's input intact.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('pre-fills the form when editing and sends a PATCH', async () => {
    const patched: unknown[] = [];
    server.use(
      listHandler(),
      http.patch(`${API}/equipment/eq-1`, async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json({ data: { ...equipment[0]!, name: 'Bioreactor 101A' } });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('link', { name: 'Bioreactor 101' });

    const card = screen.getByRole('link', { name: 'Bioreactor 101' }).closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('dialog', { name: 'Edit equipment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Bioreactor 101');
    expect(screen.getByLabelText('Code')).toHaveValue('BR-101');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Bioreactor 101A');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toMatchObject({ name: 'Bioreactor 101A', code: 'BR-101' });
  });

  it('surfaces the in-use refusal in place when deleting equipment with records', async () => {
    server.use(
      listHandler(),
      http.delete(`${API}/equipment/eq-1`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'EQUIPMENT_IN_USE',
              message:
                "This equipment has 12 cleaning record(s) and cannot be deleted. Set its status to 'retired' instead.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('link', { name: 'Bioreactor 101' });

    const card = screen.getByRole('link', { name: 'Bioreactor 101' }).closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    // Expected outcome, not an unexpected failure: the server's explanation is
    // shown in the dialog and the equipment stays put.
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be deleted');
    expect(screen.getByRole('link', { name: 'Bioreactor 101' })).toBeInTheDocument();
  });

  it('deletes unused equipment and closes the dialog', async () => {
    let deleted = false;
    server.use(
      http.get(`${API}/equipment`, () =>
        HttpResponse.json({ data: deleted ? [equipment[1]!] : equipment }),
      ),
      http.delete(`${API}/equipment/eq-1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('link', { name: 'Bioreactor 101' });

    const card = screen.getByRole('link', { name: 'Bioreactor 101' }).closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Bioreactor 101' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
