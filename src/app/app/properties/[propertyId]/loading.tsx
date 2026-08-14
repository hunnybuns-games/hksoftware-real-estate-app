import { CardSkeleton, PageHeaderSkeleton, StatTileSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
      <CardSkeleton lines={5} />
      <CardSkeleton lines={3} />
    </div>
  );
}
