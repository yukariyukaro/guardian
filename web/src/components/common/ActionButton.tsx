import type { ComponentProps } from 'react';
import { Button } from '../ui/button';

// Project-level defaults: non-submit actions are the safe default.
export function ActionButton({ type = 'button', ...props }: ComponentProps<typeof Button>) {
  return <Button type={type} {...props} />;
}
