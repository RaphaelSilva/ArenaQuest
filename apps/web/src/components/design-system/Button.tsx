import { forwardRef, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-[color:var(--accent)]
    text-[#0B0E17]
    shadow-[0_4px_20px_oklch(0.74_0.19_52_/_0.35)]
    hover:shadow-[0_6px_28px_oklch(0.74_0.19_52_/_0.45)]
    hover:translate-y-[-1px]
    transition-all
    duration-200
  `.trim(),
  secondary: `
    bg-[color:var(--bg3)]
    border
    border-[color:var(--border2)]
    text-[color:var(--text2)]
    hover:border-[color:var(--accent)]
    hover:text-[color:var(--accent)]
    transition-colors
    duration-200
  `.trim(),
  danger: `
    bg-[color:oklch(0.65_0.22_15)]
    text-white
    hover:bg-[color:oklch(0.60_0.25_15)]
    transition-colors
    duration-200
  `.trim(),
  icon: `
    w-7
    h-7
    flex
    items-center
    justify-center
    border
    border-[color:var(--border2)]
    rounded-[7px]
    hover:border-[color:var(--accent)]
    transition-colors
    duration-200
  `.trim(),
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: `
    px-3
    py-1.5
    text-sm
    font-medium
  `.trim(),
  md: `
    px-4
    py-2
    text-base
    font-medium
  `.trim(),
  lg: `
    px-6
    py-3
    text-lg
    font-semibold
  `.trim(),
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      children,
      isLoading,
      disabled,
      className,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    const baseStyles = `
      rounded-[16px]
      font-['Space_Grotesk']
      font-bold
      tracking-tight
      inline-flex
      items-center
      justify-center
      gap-2
      whitespace-nowrap
      disabled:opacity-50
      disabled:cursor-not-allowed
      focus:outline-none
      focus-visible:ring-3
      focus-visible:ring-[oklch(0.74_0.19_52_/_0.12)]
    `.trim();

    const variantClass = variantStyles[variant];
    const sizeClass = variant === 'icon' ? '' : sizeStyles[size];

    const combinedClassName = `
      ${baseStyles}
      ${variantClass}
      ${sizeClass}
      ${className || ''}
    `
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={combinedClassName}
        {...props}
      >
        {isLoading && (
          <svg
            className="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize };
