"use client";

/**
 * Dark-theme toggle for the /v2 surface.
 *
 * DSH themes key off `body[data-ds-dark-theme]`, so the attribute lives on the
 * document body; the state is mirrored here because the button also renders the
 * current mode. Only mounted on /v2 while the migration is in progress.
 */
import { useEffect, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";

export function ThemeToggle(): React.ReactNode {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (dark) document.body.setAttribute("data-ds-dark-theme", "");
    else document.body.removeAttribute("data-ds-dark-theme");
    return () => document.body.removeAttribute("data-ds-dark-theme");
  }, [dark]);

  return (
    <Button variant="outline" size="sm" aria-pressed={dark} onClick={() => setDark((v) => !v)}>
      {dark ? "浅色主题" : "深色主题"}
    </Button>
  );
}
