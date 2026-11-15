"use client";

import * as React from "react";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { TaskWorkspaceDsh } from "./task-workspace-dsh";

// The legacy multi-tab detail statically imports ~10 tab modules (sessions,
// overview, coverage graph with @xyflow/react, …). Loading it eagerly made the
// new-shell route ship 37 chunks / 64 resources and pushed first paint to
// seconds. It is now a separate chunk fetched only when the flag is off.
const LegacyTaskDetail = dynamic(() => import("./legacy-detail"), { ssr: false });

// The harness workspace is the product default; the legacy multi-tab page is
// opt-in. Inverted from an opt-in flag because `NEXT_PUBLIC_*` inlining proved
// unreliable here (the literal survived into the exported chunk).
const LEGACY_SHELL = process.env.NEXT_PUBLIC_LEGACY_SHELL === "1";

// useSearchParams must sit under a Suspense boundary for static export.
function TaskDetailRoute() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";

  if (!LEGACY_SHELL) return <TaskWorkspaceDsh taskId={id} />;
  return <LegacyTaskDetail />;
}

export default function TaskDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <TaskDetailRoute />
    </React.Suspense>
  );
}
