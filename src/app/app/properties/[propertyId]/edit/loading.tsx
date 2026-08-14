import { CardSkeleton, PageHeaderSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction={false} />
      <CardSkeleton lines={5} title={false} />
      <CardSkeleton lines={1} />
    </div>
  );
}
