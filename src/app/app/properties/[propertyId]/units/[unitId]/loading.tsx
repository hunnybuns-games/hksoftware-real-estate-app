import { CardSkeleton, PageHeaderSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <CardSkeleton lines={3} />
      <CardSkeleton lines={2} />
    </div>
  );
}
