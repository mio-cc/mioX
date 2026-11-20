/**
 * Text model for the composer's contenteditable draft surface.
 *
 * The editor is a plain-text contenteditable (`plaintext-only`). Text nodes
 * contribute their characters, a line-break element contributes one newline,
 * and a block boundary (reachable through Chrome's own multiline paste shape)
 * separates the block from its preceding line. Chrome keeps one extra trailing
 * newline text node while the caret sits on a freshly broken last line, so the
 * reported draft drops that caret-line newline: a draft that ends with a line
 * break reads back as `"a\n"`, not `"a\n\n"`.
 *
 * `readDraftState` is the one source for both the draft text and the caret
 * offset; `locateTextOffset` is its inverse walk. Keeping them in one module is
 * what lets `/` and `@` triggers stay aligned after the caret moves, and lets a
 * picked trigger row replace exactly the typed token.
 */
const NEWLINE = "\n";

/** Block-level tags whose boundary separates lines in a pasted draft. */
const BLOCK_TAG = /^(?:DIV|P|LI|BLOCKQUOTE|PRE|H[1-6]|UL|OL)$/;

/** One DOM boundary used to build a range from a text offset. */
export interface DomPoint {
  readonly node: Node;
  readonly offset: number;
}

/** The draft text plus the caret's offset into it. */
export interface DraftState {
  readonly text: string;
  readonly caret: number | null;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

function isBlockElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAG.test((node as Element).tagName);
}

function isLineBreak(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && node.nodeName === "BR";
}

function childIndex(parent: Node, child: Node): number {
  return (Array.from(parent.childNodes) as Node[]).indexOf(child);
}

function appendText(node: Node, parts: string[]): void {
  if (isTextNode(node)) {
    parts.push(node.nodeValue ?? "");
    return;
  }
  if (isLineBreak(node)) {
    parts.push(NEWLINE);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  for (const child of Array.from(node.childNodes)) {
    if (isBlockElement(child) && parts.length > 0) {
      const tail = parts[parts.length - 1] ?? "";
      if (tail !== "" && !tail.endsWith(NEWLINE)) parts.push(NEWLINE);
    }
    appendText(child, parts);
  }
}

/** The deepest trailing node, used to recognise the caret-line newline. */
function lastNode(node: Node): Node | null {
  let current: Node | null = node;
  while (current !== null && current.lastChild !== null) current = current.lastChild;
  return current;
}

/**
 * Whether the DOM's tail is Chrome's caret-line newline: the last node is a
 * text node whose content ends with a newline.
 * @param root - the contenteditable surface.
 * @returns true when one trailing newline is Chrome's caret placeholder.
 */
function hasTrailingCaretNewline(root: Node): boolean {
  const node = lastNode(root);
  return node !== null && isTextNode(node) && (node.nodeValue ?? "").endsWith(NEWLINE);
}

function collectRawText(root: Node): string {
  const parts: string[] = [];
  appendText(root, parts);
  return parts.join("");
}

function caretRawOffset(root: HTMLElement): number | null {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const prefix = root.ownerDocument.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const parts: string[] = [];
  appendText(prefix.cloneContents(), parts);
  return parts.join("").length;
}

/** Whether the DOM is Chrome's "nothing typed" placeholder: one empty line box. */
function isEmptyPlaceholderDom(root: Node): boolean {
  if (root.childNodes.length === 0) return true;
  if (root.childNodes.length > 1) return false;
  const only = root.childNodes[0] as Node;
  if (isLineBreak(only)) return true;
  if (!isBlockElement(only)) return false;
  const element = only as Element;
  return (
    element.childNodes.length === 0 || (element.childNodes.length === 1 && isLineBreak(element.childNodes[0] as Node))
  );
}

/**
 * Read the draft text the editor currently holds.
 * @param root - the contenteditable surface.
 * @returns the plain-text draft, newline separated.
 */
export function readDraftText(root: Node): string {
  // An editor emptied through the browser keeps one placeholder line box; that
  // is the empty draft, not a single blank line.
  if (isEmptyPlaceholderDom(root)) return "";
  const raw = collectRawText(root);
  return hasTrailingCaretNewline(root) ? raw.slice(0, -1) : raw;
}

/**
 * Read the draft text together with the caret offset into that text.
 * @param root - the contenteditable surface.
 * @returns the draft text and caret offset; the caret is null outside the surface.
 */
export function readDraftState(root: HTMLElement): DraftState {
  const text = readDraftText(root);
  const rawCaret = caretRawOffset(root);
  return { text, caret: rawCaret === null ? null : Math.min(rawCaret, text.length) };
}

/**
 * Resolve a draft offset to the earliest DOM point that reports it.
 * @param root - the contenteditable surface.
 * @param target - offset into the raw draft text.
 * @returns the DOM boundary, or null when the offset is outside the draft.
 */
export function locateTextOffset(root: Node, target: number): DomPoint | null {
  if (target < 0) return null;
  let position = 0;
  let last = "";
  let found: DomPoint | null = null;
  const pointFor = (node: Node): DomPoint => {
    if (isLineBreak(node)) {
      const parent = node.parentNode;
      if (parent !== null) return { node: parent, offset: childIndex(parent, node) };
    }
    return { node, offset: 0 };
  };
  const visit = (node: Node): void => {
    if (found !== null) return;
    if (position === target) {
      found = pointFor(node);
      return;
    }
    if (isTextNode(node)) {
      const value = node.nodeValue ?? "";
      if (target <= position + value.length) {
        found = { node, offset: target - position };
        return;
      }
      position += value.length;
      if (value !== "") last = value.charAt(value.length - 1);
      return;
    }
    if (isLineBreak(node)) {
      position += 1;
      last = NEWLINE;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    for (const child of Array.from(node.childNodes)) {
      if (isBlockElement(child) && position > 0 && last !== NEWLINE) {
        if (position === target) {
          found = { node, offset: childIndex(node, child) };
          return;
        }
        position += 1;
        last = NEWLINE;
        if (position === target) {
          found = { node, offset: childIndex(node, child) };
          return;
        }
      }
      visit(child);
      if (found !== null) return;
    }
  };
  visit(root);
  if (found === null && position === target) found = { node: root, offset: root.childNodes.length };
  return found;
}

/** Move the DOM selection onto one draft range. */
function selectRange(root: HTMLElement, start: number, end: number): Range | null {
  const startPoint = locateTextOffset(root, start);
  const endPoint = locateTextOffset(root, end);
  if (startPoint === null || endPoint === null) return null;
  const doc = root.ownerDocument;
  const range = doc.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const selection = doc.getSelection();
  if (selection === null) return null;
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

/** Fallback insertion through DOM ranges when the editing command is unavailable. */
function insertByRange(root: HTMLElement, selected: Range | null, text: string): void {
  const doc = root.ownerDocument;
  let range = selected?.cloneRange() ?? null;
  if (range === null) {
    range = doc.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  const node = doc.createTextNode(text);
  range.insertNode(node);
  const caret = doc.createRange();
  caret.setStart(node, node.length);
  caret.collapse(true);
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caret);
}

/**
 * Insert plain text at the current selection, replacing selected content.
 * @param root - the contenteditable surface.
 * @param text - plain text; newlines keep their plain-text meaning.
 * @returns the caret offset after the insertion, or null when the surface is detached.
 */
export function insertPlainTextAtCaret(root: HTMLElement, text: string): number | null {
  const doc = root.ownerDocument;
  if (doc.activeElement !== root) root.focus({ preventScroll: true });
  if (doc.execCommand("insertText", false, text)) return readDraftState(root).caret;
  insertByRange(root, null, text);
  return readDraftState(root).caret;
}

/**
 * Insert one line break at the caret through the browser's editing command so
 * the caret line stays visible and the next keystroke continues on it.
 * @param root - the contenteditable surface.
 * @returns the caret offset after the break, or null when the surface is detached.
 */
export function insertLineBreakAtCaret(root: HTMLElement): number | null {
  const doc = root.ownerDocument;
  if (doc.activeElement !== root) root.focus({ preventScroll: true });
  if (!doc.execCommand("insertLineBreak")) insertByRange(root, null, NEWLINE);
  return readDraftState(root).caret;
}

/**
 * Replace one draft range with plain text and leave the caret after it.
 * @param root - the contenteditable surface.
 * @param start - range start offset into the draft text.
 * @param end - range end offset into the draft text.
 * @param text - replacement text.
 * @returns the caret offset after the replacement, or null when the range is stale.
 */
export function replaceTextRange(root: HTMLElement, start: number, end: number, text: string): number | null {
  const doc = root.ownerDocument;
  const range = selectRange(root, start, end);
  if (range === null) return null;
  if (doc.activeElement !== root) root.focus({ preventScroll: true });
  // The editing command keeps the browser's own caret state in step with the
  // replacement; a raw DOM splice would desynchronise the next keystroke.
  if (!doc.execCommand("insertText", false, text)) insertByRange(root, range, text);
  return readDraftState(root).caret;
}
