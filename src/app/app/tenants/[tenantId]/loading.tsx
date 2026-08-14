import { CardSkeleton, PageHeaderSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={2} />
        </div>
        <div className="space-y-6">
          <CardSkeleton lines={2} />
        </div>
      </div>
    </div>
  );
}
