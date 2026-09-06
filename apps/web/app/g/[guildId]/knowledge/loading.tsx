import { Skeleton } from '@kalvard/ui';

export default function Loading() {
  return (
    <div className="max-w-[880px]">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-4 h-5 w-96 max-w-full" />
      <Skeleton className="mt-12 h-6 w-24" />
      <Skeleton className="mt-2 h-5 w-80 max-w-full" />
      <Skeleton className="mt-12 h-64 w-full max-w-[60ch]" />
    </div>
  );
}
