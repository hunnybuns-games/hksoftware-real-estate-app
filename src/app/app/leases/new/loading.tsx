import { CardSkeleton, PageHeaderSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction={false} />
      <CardSkeleton lines={2} title={false} />
      <CardSkeleton lines={6} title={false} />
    </div>
  );
}
