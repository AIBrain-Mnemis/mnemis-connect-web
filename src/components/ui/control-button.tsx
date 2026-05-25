import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const controlButtonVariants = cva('rounded-full transition-colors', {
  variants: {
    tone: {
      neutral: 'bg-gray-700 text-white hover:bg-gray-600',
      active:
        'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/50 hover:bg-emerald-500/30 hover:text-emerald-300',
      warning: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300',
      destructive: 'bg-red-600 text-white hover:bg-red-700',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});

interface ControlButtonProps
  extends
    Omit<React.ComponentProps<typeof Button>, 'size' | 'variant'>,
    VariantProps<typeof controlButtonVariants> {
  label: string;
  icon: React.ReactNode;
  labelClassName?: string;
}

function ControlButton({
  tone,
  label,
  icon,
  className,
  labelClassName,
  ...props
}: ControlButtonProps) {
  return (
    <div className="flex flex-col items-center">
      <Button
        variant="ghost"
        size="icon-xl"
        className={cn(controlButtonVariants({ tone }), 'md:size-14 md:[&_svg]:size-6', className)}
        aria-label={label}
        {...props}
      >
        {icon}
      </Button>
      <span className={cn('mt-1 text-[10px] text-gray-400 md:text-xs', labelClassName)}>
        {label}
      </span>
    </div>
  );
}

export { ControlButton, controlButtonVariants };
