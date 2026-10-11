import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input data-slot="input" type={type} className={cn('min-w-0 w-full', className)} {...props} />
  );
}
