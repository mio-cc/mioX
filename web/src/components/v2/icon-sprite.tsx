"use client";

/**
 * Mounts the vendored DSH icon sprite into the document.
 *
 * Product icons render as `<use href="#dsw-icon-<glyph>-<weight>">`, so the
 * symbol table has to exist before those components paint. Ported from
 * ui-lab's Cordis-free installer: one document, no theme-artwork swapping.
 */
import { useEffect } from "react";

import { ICON_SYMBOLS } from "@/vendor/dsh/primitives/icons/artwork";

const SVG_NS = "http://www.w3.org/2000/svg";
const DROPPED_ATTRIBUTES = new Set(["width", "height", "xmlns", "class", "aria-hidden"]);

function toSymbol(id: string, markup: string): SVGSymbolElement {
  const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  const symbol = document.createElementNS(SVG_NS, "symbol");
  for (const { name, value } of root.attributes) {
    if (!DROPPED_ATTRIBUTES.has(name)) symbol.setAttribute(name, value);
  }
  symbol.id = id;
  symbol.append(...[...root.childNodes].map((node) => document.importNode(node, true)));
  return symbol;
}

export function IconSprite(): null {
  useEffect(() => {
    if (document.querySelector("[data-dsh-icon-sprite]") !== null) return;
    const sprite = document.createElementNS(SVG_NS, "svg");
    sprite.setAttribute("aria-hidden", "true");
    sprite.setAttribute("data-dsh-icon-sprite", "");
    sprite.style.cssText = "position: absolute; width: 0; height: 0; overflow: hidden";
    for (const [id, markup] of Object.entries(ICON_SYMBOLS)) {
      sprite.append(toSymbol(id, markup));
    }
    document.body.prepend(sprite);
  }, []);

  return null;
}
