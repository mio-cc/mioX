import type { ReactNode } from "react";

import { AuthGate } from "@/components/v2/auth/AuthGate";
import { IconSprite } from "@/components/v2/icon-sprite";

// DSH design tokens and theme layers. Imported here (not in the root layout) so
// the existing routes keep their current styling during the migration.
import "@/styles/dsw.css";
// mioX theme layer (font stack, numerals) — must load after dsw.css.
import "@/styles/miox-theme.css";

export default function V2Layout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <div className="v2-scope">
      <IconSprite />
      <AuthGate>{children}</AuthGate>
    </div>
  );
}
