import { describe, it, expect } from 'vitest';
import { toCsv } from '../ledger-csv';

type Row = { name: string; amount: number };

describe('toCsv', () => {
  it('writes the header row followed by one line per row', () => {
    const csv = toCsv<Row>(
      [
        { name: 'Alice', amount: 1 },
        { name: 'Bruno', amount: 2 },
      ],
      [
        { header: 'Name', value: (row) => row.name },
        { header: 'Amount', value: (row) => String(row.amount) },
      ],
    );
    expect(csv).toBe('Name,Amount\r\nAlice,1\r\nBruno,2');
  });

  it('quotes a field holding a comma, a quote or a newline', () => {
    const csv = toCsv<Row>([{ name: 'Doe, "AJ"\nJr', amount: 3 }], [
      { header: 'Name', value: (row) => row.name },
      { header: 'Amount', value: (row) => String(row.amount) },
    ]);
    expect(csv).toBe('Name,Amount\r\n"Doe, ""AJ""\nJr",3');
  });

  it('emits the header alone for an empty view', () => {
    expect(toCsv<Row>([], [{ header: 'Name', value: (row) => row.name }])).toBe('Name');
  });
});
