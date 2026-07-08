import { forwardRef, ReactNode, useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  error?: string;
  label?: string;
  helperText?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      icon,
      error,
      label,
      helperText,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const baseStyles = `
      w-full
      h-10
      px-3
      py-2
      font-['DM_Sans']
      text-sm
      text-[color:var(--text)]
      bg-[color:var(--bg3)]
      border
      border-[color:var(--border2)]
      rounded-lg
      placeholder:text-[color:var(--text3)]
      focus:outline-none
      focus:border-[color:var(--accent)]
      focus:ring-3
      focus:ring-[oklch(0.74_0.19_52_/_0.12)]
      transition-all
      duration-200
      caret-[color:var(--accent)]
      disabled:opacity-50
      disabled:cursor-not-allowed
    `.trim();

    const errorStyles = error
      ? `
        border-[color:oklch(0.65_0.22_15)]
        ring-3
        ring-[oklch(0.65_0.22_15_/_0.12)]
      `.trim()
      : '';

    const iconPadding = icon ? 'pl-10' : '';

    const combinedClassName = `
      ${baseStyles}
      ${errorStyles}
      ${iconPadding}
      ${className || ''}
    `
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text3)] pointer-events-none group-focus-within:text-[color:var(--accent)] transition-colors duration-200 flex items-center justify-center w-4 h-4">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={combinedClassName}
            {...props}
          />
        </div>
        {error && (
          <div className="text-xs text-[color:oklch(0.65_0.22_15)] font-medium">
            {error}
          </div>
        )}
        {helperText && !error && (
          <div className="text-xs text-[color:var(--text3)]">
            {helperText}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input, type InputProps };
