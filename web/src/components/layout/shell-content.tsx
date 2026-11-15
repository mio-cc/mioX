"use client";

import * as React from "react";

import { usePathname } from "next/navigation";

import { PanelRight } from "lucide-react";

import { useAppLayout } from "@/components/layout/app-frame";
import { cn } from "@/lib/utils";

function isFullBleed(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.startsWith("/function/tasks/");
}

export function ShellContent({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname();
  const { rightOpen, toggleRight } = useAppLayout();
  const fullBleed = isFullBleed(pathname);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* The sidebar toggle lives in the sidebar itself (brand row / 56px rail).
          Only the right inspector toggle belongs to the main content chrome. */}
      {fullBleed ? null : (
        <div className="pointer-events-none absolute right-2 top-2 z-20 flex gap-1">
          <button
            type="button"
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            onClick={toggleRight}
            title="右侧栏 (Ctrl+Shift+B)"
            aria-label="切换右侧检查器"
            aria-expanded={rightOpen}
            aria-pressed={rightOpen}
            data-testid="toggle-right"
          >
            <PanelRight size={16} />
          </button>
        </div>
      )}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden",
          fullBleed ? "overflow-hidden" : "overflow-y-auto p-4 md:p-6",
        )}
      >
        {children}
      </div>
    </div>
  );
}
