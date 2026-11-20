"use client";

/**
 * The composer's contenteditable draft surface.
 *
 * Port of `ui-conversation/src/client/input/editor/DraftEditor.tsx` and
 * `ComposerContentEditable.tsx`: one scrollport, one plain-text editable div
 * (`role="textbox"`, `aria-multiline`), a placeholder overlaid over the same
 * line box, and the composing attribute that hides it. The shell-owned Lexical
 * editor has no counterpart here; the DOM itself is the editor, so the draft
 * text and the caret offset come from `editor-dom.ts`.
 *
 * The element is intentionally uncontrolled: React owns its attributes, the
 * browser owns its children. Draft text reaches the composer through
 * `onDraftChange`; clearing, line breaks, pastes, and trigger-token replacement
 * go through the imperative handle.
 */
import * as React from "react";

import css from "./Composer.module.css";
import { insertLineBreakAtCaret, insertPlainTextAtCaret, readDraftState, replaceTextRange } from "./editor-dom";

/** Composition guards hold one tick past `compositionend` (Safari's late closing keydown). */
const COMPOSITION_TAIL_MS = 10;

/** Imperative surface the composer drives the editor with. */
export interface ComposerEditorHandle {
  focus(): void;
  /** Drop the whole draft (after a successful send). */
  clear(): void;
  /** Insert one line break at the caret (Shift+Enter). */
  insertLineBreak(): void;
  /** Insert plain text at the caret, replacing any selection (paste). */
  insertPlainText(text: string): void;
  /** Replace a draft range with plain text and park the caret after it (trigger pick). */
  replaceRange(start: number, end: number, text: string): void;
  /** Whether an IME composition is running or just finished. */
  recentlyComposing(): boolean;
}

export interface ComposerEditorProps {
  /** Placeholder copy; also the editor's accessible name, as in the source. */
  readonly placeholder: string;
  /** Whether the surface accepts edits (false while a send is in flight). */
  readonly editable: boolean;
  /** Placeholder visibility, decided by the owner (draft empty and no attachments). */
  readonly showPlaceholder: boolean;
  readonly handleRef?: React.Ref<ComposerEditorHandle>;
  /**
   * Report every draft change with the caret offset recomputed from the DOM.
   * `composing` is true while an IME composition is in progress, so the owner
   * can ignore partial candidate text when it decides about `/` and `@`.
   */
  readonly onDraftChange: (text: string, caret: number | null, composing: boolean) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}

/**
 * Render the draft scrollport, the editable div, and the placeholder.
 * @param props - draft surface values and the composer's keyboard/paste handlers.
 * @returns the draft surface.
 */
export function ComposerEditor({
  placeholder,
  editable,
  showPlaceholder,
  handleRef,
  onDraftChange,
  onKeyDown,
  onPaste,
}: ComposerEditorProps): React.ReactNode {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const composing = React.useRef(false);
  const composingUntil = React.useRef(0);
  const changeRef = React.useRef(onDraftChange);
  React.useEffect(() => {
    changeRef.current = onDraftChange;
  });

  const notify = React.useCallback((composingNow: boolean): void => {
    const root = rootRef.current;
    if (root === null) return;
    const { text, caret } = readDraftState(root);
    changeRef.current(text, caret, composingNow);
  }, []);

  React.useImperativeHandle(
    handleRef,
    () => ({
      focus: () => {
        rootRef.current?.focus({ preventScroll: true });
      },
      clear: () => {
        const root = rootRef.current;
        if (root !== null) root.textContent = "";
      },
      insertLineBreak: () => {
        const root = rootRef.current;
        if (root === null) return;
        insertLineBreakAtCaret(root);
        notify(false);
      },
      insertPlainText: (text: string) => {
        const root = rootRef.current;
        if (root === null) return;
        insertPlainTextAtCaret(root, text);
        notify(false);
      },
      replaceRange: (start: number, end: number, text: string) => {
        const root = rootRef.current;
        if (root === null) return;
        replaceTextRange(root, start, end, text);
        notify(false);
      },
      recentlyComposing: () => composing.current || Date.now() < composingUntil.current,
    }),
    [notify],
  );

  const handleCompositionStart = (): void => {
    composing.current = true;
    rootRef.current?.setAttribute("data-composer-composing", "");
  };

  const handleCompositionEnd = (): void => {
    composing.current = false;
    composingUntil.current = Date.now() + COMPOSITION_TAIL_MS;
    rootRef.current?.removeAttribute("data-composer-composing");
    // The committed candidate text is in the DOM by the time this fires; some
    // engines emit the final input event afterwards, and that one re-syncs.
    notify(false);
  };

  const handleInput = (event: React.FormEvent<HTMLDivElement>): void => {
    const native = event.nativeEvent as InputEvent;
    notify(composing.current || native.isComposing === true);
  };

  const syncCaret = (): void => {
    if (!composing.current) notify(false);
  };

  return (
    <div className={css.scroll} data-input-scroll="">
      <div className={css.grow}>
        {/* biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: contenteditable
            is natively focusable, and a textarea cannot host the browser's rich
            plain-text caret/IME model; the DOM mirrors the source composer's div[role=textbox]. */}
        <div
          ref={rootRef}
          className={css.input}
          contentEditable={editable ? "plaintext-only" : false}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          aria-disabled={editable ? undefined : true}
          data-composer-input=""
          data-placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onMouseUp={syncCaret}
          onPaste={onPaste}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
        {showPlaceholder ? (
          <div aria-hidden className={css.placeholder} data-composer-placeholder="">
            {placeholder}
          </div>
        ) : null}
      </div>
    </div>
  );
}
