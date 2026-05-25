import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  isHoverable?: boolean;
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  isHeader?: boolean;
}

function Table({ children, className }: TableProps) {
  return (
    <div className={`overflow-x-auto ${className || ''}`}>
      <table className="w-full border-collapse">
        {children}
      </table>
    </div>
  );
}

function TableHeader({ children, className }: TableHeaderProps) {
  return (
    <thead className={className}>
      {children}
    </thead>
  );
}

function TableBody({ children, className }: TableBodyProps) {
  return (
    <tbody className={className}>
      {children}
    </tbody>
  );
}

function TableRow({
  children,
  className,
  isHoverable = true,
}: TableRowProps) {
  const hoverClass = isHoverable
    ? `
      hover:bg-[color:var(--bg3)]
      transition-colors
      duration-150
    `.trim()
    : '';

  return (
    <tr
      className={`
        border-b
        border-[color:var(--border)]
        ${hoverClass}
        ${className || ''}
      `
        .split(/\s+/)
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </tr>
  );
}

function TableCell({
  children,
  className,
  isHeader = false,
}: TableCellProps) {
  const baseStyles = `
    px-4
    py-3
    text-left
  `.trim();

  const headerStyles = isHeader
    ? `
      font-['Space_Grotesk']
      font-semibold
      text-xs
      uppercase
      letter-spacing-[1px]
      text-[color:var(--text2)]
      bg-[color:var(--bg2)]
    `.trim()
    : `
      font-['DM_Sans']
      text-sm
      text-[color:var(--text)]
    `.trim();

  return (
    <td
      className={`
        ${baseStyles}
        ${headerStyles}
        ${className || ''}
      `
        .split(/\s+/)
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  );
}

export { Table, TableHeader, TableBody, TableRow, TableCell };
export type { TableProps, TableHeaderProps, TableBodyProps, TableRowProps, TableCellProps };
