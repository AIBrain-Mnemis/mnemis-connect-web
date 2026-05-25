import { cn } from '@/lib/utils';

function AmbientBackground({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot="ambient-background"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100" />
      <div className="absolute inset-0 bg-gradient-to-t from-white/40 via-transparent to-transparent" />
      <div className="absolute top-1/4 -left-20 size-80 rounded-full bg-sky-200/50 blur-3xl" />
      <div className="absolute bottom-1/4 -right-20 size-96 rounded-full bg-indigo-200/40 blur-3xl" />
      <div className="absolute top-1/2 left-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-100/30 blur-3xl" />
    </div>
  );
}

export { AmbientBackground };
