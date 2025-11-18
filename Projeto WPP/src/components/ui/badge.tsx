// src/components/ui/badge.tsx
import * as React from 'react';

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

const variants: Record<BadgeVariant, string> = {
  default: 'border-slate-200 bg-slate-50 text-slate-700',
  secondary: 'border-slate-900 bg-slate-900 text-white',
  outline: 'border-slate-300 bg-transparent text-slate-700',
  destructive: 'border-rose-600 bg-rose-600 text-white',
};

export function Badge({
  className = '',
  children,
  onClick,
  variant = 'default',
}: React.PropsWithChildren<{ className?: string; onClick?: () => void; variant?: BadgeVariant }>) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
