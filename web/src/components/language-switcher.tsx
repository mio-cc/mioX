"use client";

import { Languages } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Locale, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  className,
  showIcon = true,
}: {
  readonly className?: string;
  readonly showIcon?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();

  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      <SelectTrigger className={cn("w-36", className)} aria-label={t("Interface Language")}>
        {showIcon && <Languages className="size-4 shrink-0 text-muted-foreground" />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="zh-CN">简体中文</SelectItem>
        <SelectItem value="en-US">English</SelectItem>
      </SelectContent>
    </Select>
  );
}
