import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from './Combobox';

const OPTIONS: ComboboxOption[] = [
  { value: 'u1', label: 'Alice Chen', hint: 'alice@example.com' },
  { value: 'u2', label: 'Bob Novak', hint: 'bob@example.com' },
  { value: 'u3', label: 'Carol Diaz', hint: 'carol@example.com' },
  { value: 'u4', label: 'Hana Suzuki', hint: 'hana@example.com' },
];

/** Wraps the controlled component so selection actually sticks, as in real use. */
function Harness({ onChange, initial = null }: { onChange?: (v: string) => void; initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <Combobox
      id="picker"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const input = () => screen.getByRole('combobox');

describe('Combobox', () => {
  it('exposes the ARIA combobox contract', () => {
    render(<Harness />);

    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens on focus and lists every option', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(input());

    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('filters as you type, matching the label or the hint', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(input());
    await user.type(input(), 'car');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Carol Diaz'),
    ]);

    // Searching by email must work too — that is the point of the hint line.
    await user.clear(input());
    await user.type(input(), 'hana@');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Hana Suzuki'),
    ]);
  });

  it('matches case-insensitively', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(input());
    await user.type(input(), 'ALICE');

    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('reports when nothing matches instead of showing an empty list', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(input());
    await user.type(input(), 'zzzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('selects with the mouse and shows the chosen label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(input());
    await user.click(screen.getByText('Bob Novak'));

    expect(onChange).toHaveBeenCalledWith('u2');
    expect(input()).toHaveValue('Bob Novak');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('is fully operable by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(input());
    // Focus stays on the input while arrows move the *active* option — that is
    // what aria-activedescendant is for, and why typing keeps working.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input()).toHaveFocus();

    const activeId = input().getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)).toHaveTextContent('Carol Diaz');

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('u3');
    expect(input()).toHaveValue('Carol Diaz');
  });

  it('wraps around the ends of the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(input());
    // Up from the first option lands on the last, so a long list is reachable
    // from either direction.
    await user.keyboard('{ArrowUp}');

    const activeId = input().getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)).toHaveTextContent('Hana Suzuki');
  });

  it('closes on Escape without committing a selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(input());
    await user.keyboard('{ArrowDown}{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(input()).toHaveValue('');
  });

  it('reverts the typed query when closed without committing', async () => {
    const user = userEvent.setup();
    render(<Harness initial="u1" />);

    expect(input()).toHaveValue('Alice Chen');

    await user.click(input());
    await user.type(input(), 'Bob');
    await user.keyboard('{Escape}');

    // The visible text can never disagree with the value actually held.
    expect(input()).toHaveValue('Alice Chen');
  });

  it('marks the current selection in the list', async () => {
    const user = userEvent.setup();
    render(<Harness initial="u2" />);

    await user.click(input());

    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(within(selected[0]!).getByText('Bob Novak')).toBeInTheDocument();
  });
});
