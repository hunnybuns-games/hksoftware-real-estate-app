import { CardSkeleton, PageHeaderSkeleton, StatTileSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction={false} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
    </div>
  );
}
