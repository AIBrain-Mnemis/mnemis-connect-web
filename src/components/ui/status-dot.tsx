import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const statusDotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    tone: {
      online: 'bg-emerald-500',
      busy: 'bg-red-500',
      offline: 'bg-gray-400',
      error: 'bg-orange-500',
      loading: 'bg-gray-300',
      waiting: 'bg-amber-400',
      neutral: 'bg-gray-500',
      primary: 'bg-primary',
    },
    size: {
      sm: 'size-1.5',
      default: 'size-2',
      lg: 'size-3',
    },
    pulse: {
      true: 'animate-pulse',
      false: '',
    },
  },
  defaultVariants: {
    tone: 'neutral',
    size: 'default',
    pulse: false,
  },
});

type StatusDotProps = Omit<React.ComponentProps<'span'>, 'color'> &
  VariantProps<typeof statusDotVariants>;

function StatusDot({ className, tone, size, pulse, ...props }: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      className={cn(statusDotVariants({ tone, size, pulse }), className)}
      {...props}
    />
  );
}

export { StatusDot, statusDotVariants };
