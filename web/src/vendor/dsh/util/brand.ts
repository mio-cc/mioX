// @ts-nocheck -- vendored from deepseek-harness (MIT); typechecked upstream against React 18, not here.
﻿/** Minimal stand-in for @deepseek-ai/dsh-brand's branded string type. */
export type Branded<T, B extends string> = T & { readonly __brand: B };
