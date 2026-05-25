import * as React from 'react';
import { Bot } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const brandMarkVariants = cva(
  'flex shrink-0 items-center justify-center border border-white/50 bg-gradient-to-br from-primary/20 to-primary/5 text-primary backdrop-blur-sm',
  {
    variants: {
      size: {
        sm: 'size-10 rounded-xl [&_svg]:size-5',
        default: 'size-12 rounded-2xl [&_svg]:size-6',
        lg: 'size-16 rounded-2xl [&_svg]:size-8',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

type BrandMarkProps = Omit<React.ComponentProps<'div'>, 'size'> &
  VariantProps<typeof brandMarkVariants> & {
    icon?: React.ReactNode;
  };

function BrandMark({ className, size, icon, ...props }: BrandMarkProps) {
  return (
    <div data-slot="brand-mark" className={cn(brandMarkVariants({ size }), className)} {...props}>
      {icon ?? <Bot />}
    </div>
  );
}

export { BrandMark, brandMarkVariants };
