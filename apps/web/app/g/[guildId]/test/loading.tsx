import { Skeleton } from '@sentrybot/ui';

export default function Loading() {
  return (
    <div className="max-w-[880px]">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-4 h-5 w-96 max-w-full" />
      <Skeleton className="mt-10 h-5 w-80 max-w-full" />
      <Skeleton className="mt-10 h-11 w-full max-w-[760px]" />
    </div>
  );
}
