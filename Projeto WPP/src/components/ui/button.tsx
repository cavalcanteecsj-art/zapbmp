import * as React from 'react';

const base = "inline-flex items-center justify-center rounded-2xl px-3 py-2 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed";
const variants: Record<string, string> = {
  default: "bg-slate-900 text-white hover:bg-slate-800",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
  destructive: "bg-rose-600 text-white hover:bg-rose-700"
};

export function Button({ variant = 'default', size = 'md', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 px-2', md: 'h-9 px-3', lg: 'h-10 px-4' };
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
