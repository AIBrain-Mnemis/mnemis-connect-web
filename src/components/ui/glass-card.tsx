import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const glassCardVariants = cva(
  'rounded-3xl border border-white/50 bg-white/60 shadow-lg shadow-black/5 backdrop-blur-xl',
  {
    variants: {
      padding: {
        none: '',
        sm: 'p-4',
        default: 'p-6',
        lg: 'p-8',
      },
    },
    defaultVariants: {
      padding: 'lg',
    },
  }
);

type GlassCardProps = React.ComponentProps<'div'> & VariantProps<typeof glassCardVariants>;

function GlassCard({ className, padding, ...props }: GlassCardProps) {
  return (
    <div
      data-slot="glass-card"
      className={cn(glassCardVariants({ padding }), className)}
      {...props}
    />
  );
}

export { GlassCard, glassCardVariants };
