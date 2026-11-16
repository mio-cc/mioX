"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * 任务工作区骨架屏(U1):详情页的 Suspense fallback 与工作区空 id 守卫共用。
 * 之前详情页是 `fallback={null}` —— 参数未就绪时主区整块留白,像"工作区不显示"。
 */
export function WorkspaceSkeleton() {
  return (
    <div data-testid="workspace-skeleton" role="status" aria-busy="true" aria-label="正在加载任务工作区">
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
