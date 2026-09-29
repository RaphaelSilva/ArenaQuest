import React, { useState } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { dictPt } from '@web/i18n';
import { DictProvider } from '@web/context/dict-context';
import { TagCombobox, type TagChipValue } from '@web/components/admin/TagCombobox';
import type { AdminTag } from '@web/lib/admin-tags-api';

const d = dictPt.admin.topics.detail;

const CHUDAN: AdminTag = { id: 't-chudan', name: 'Chūdan', slug: 'chudan' };

function Harness({
  initial = [],
  searchTags,
  onChangeSpy,
}: {
  initial?: TagChipValue[];
  searchTags: (q: string) => Promise<AdminTag[]>;
  onChangeSpy?: (next: TagChipValue[]) => void;
}) {
  const [value, setValue] = useState<TagChipValue[]>(initial);
  return (
    <DictProvider value={dictPt}>
      <TagCombobox
        id="tags"
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          setValue(next);
        }}
        searchTags={searchTags}
      />
    </DictProvider>
  );
}

function chipNames(): string[] {
  return screen
    .queryAllByRole('button', { name: /./ })
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((l) => l.startsWith(d.tagRemoveAriaLabel('')))
    .map((l) => l.slice(d.tagRemoveAriaLabel('').length));
}

describe('TagCombobox', () => {
  it('typing "chu" shows Chūdan from the lookup, and selecting it adds a chip', async () => {
    const user = userEvent.setup();
    const searchTags = vi.fn().mockResolvedValue([CHUDAN]);
    render(<Harness searchTags={searchTags} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'chu');

    const option = await screen.findByRole('option', { name: 'Chūdan' });
    expect(searchTags).toHaveBeenLastCalledWith('chu');
    // Debounced: one lookup for the whole word, not one per keystroke.
    expect(searchTags).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await user.click(option);

    expect(chipNames()).toEqual(['Chūdan']);
    expect(screen.queryByText(d.tagNewMarker)).toBeNull();
    expect(input).toHaveValue('');
  });

  it('ArrowDown + Enter picks the active suggestion', async () => {
    const user = userEvent.setup();
    const searchTags = vi.fn().mockResolvedValue([CHUDAN]);
    render(<Harness searchTags={searchTags} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'chu');
    await screen.findByRole('option', { name: 'Chūdan' });
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Chūdan' })).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Chūdan' }).id,
    );
    await user.keyboard('{Enter}');

    expect(chipNames()).toEqual(['Chūdan']);
  });

  it('Enter on "Kihon novo" with no suggestion adds a chip marked as new', async () => {
    const user = userEvent.setup();
    const searchTags = vi.fn().mockResolvedValue([]);
    render(<Harness searchTags={searchTags} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'Kihon novo');
    await screen.findByText(d.tagNoSuggestions);
    await user.keyboard('{Enter}');

    expect(chipNames()).toEqual(['Kihon novo']);
    expect(screen.getByText(d.tagNewMarker)).toBeInTheDocument();
  });

  it('adding "CHUDAN" while a "Chūdan" chip is present adds nothing', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    const searchTags = vi.fn().mockResolvedValue([CHUDAN]);
    render(
      <Harness
        initial={[{ name: 'Chūdan', isNew: false }]}
        searchTags={searchTags}
        onChangeSpy={onChangeSpy}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'CHUDAN');
    await waitFor(() => expect(searchTags).toHaveBeenCalledWith('CHUDAN'));
    // The existing chip is filtered out of the suggestions.
    expect(screen.queryByRole('option', { name: 'Chūdan' })).toBeNull();
    await user.keyboard('{Enter}');

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(chipNames()).toEqual(['Chūdan']);
  });

  it('ignores a name whose slug is empty', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness searchTags={vi.fn().mockResolvedValue([])} onChangeSpy={onChangeSpy} />);

    await user.type(screen.getByRole('combobox'), '!!!{Enter}');
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it('the remove button drops that chip', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[{ name: 'Chūdan', isNew: false }, { name: 'Kata', isNew: false }]}
        searchTags={vi.fn().mockResolvedValue([])}
      />,
    );

    await user.click(screen.getByRole('button', { name: d.tagRemoveAriaLabel('Chūdan') }));
    expect(chipNames()).toEqual(['Kata']);
  });

  it('Backspace on an empty input removes the last chip', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[{ name: 'Chūdan', isNew: false }, { name: 'Kata', isNew: false }]}
        searchTags={vi.fn().mockResolvedValue([])}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Backspace}');
    expect(chipNames()).toEqual(['Chūdan']);
  });

  it('Escape closes the suggestion list', async () => {
    const user = userEvent.setup();
    render(<Harness searchTags={vi.fn().mockResolvedValue([CHUDAN])} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'chu');
    await screen.findByRole('option', { name: 'Chūdan' });
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('an empty input sends no request', async () => {
    const user = userEvent.setup();
    const searchTags = vi.fn().mockResolvedValue([CHUDAN]);
    render(<Harness searchTags={searchTags} />);

    await user.type(screen.getByRole('combobox'), '   ');
    await new Promise((r) => setTimeout(r, 300));
    expect(searchTags).not.toHaveBeenCalled();
  });

  it('a stale response never overwrites a newer one', async () => {
    const user = userEvent.setup();
    const resolvers: Record<string, (tags: AdminTag[]) => void> = {};
    const searchTags = vi.fn(
      (q: string) => new Promise<AdminTag[]>((resolve) => { resolvers[q] = resolve; }),
    );
    render(<Harness searchTags={searchTags} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'ki');
    await waitFor(() => expect(searchTags).toHaveBeenCalledWith('ki'));
    await user.type(input, 'hon');
    await waitFor(() => expect(searchTags).toHaveBeenCalledWith('kihon'));

    // The newer lookup lands first, then the stale one.
    await act(async () => {
      resolvers['kihon']([{ id: 't-kihon', name: 'Kihon', slug: 'kihon' }]);
    });
    await screen.findByRole('option', { name: 'Kihon' });
    await act(async () => {
      resolvers['ki']([{ id: 't-kime', name: 'Kime', slug: 'kime' }]);
    });

    expect(screen.getByRole('option', { name: 'Kihon' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Kime' })).toBeNull();
  });
});
