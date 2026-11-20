"use client";

/**
 * Session hierarchy in the conversation title row.
 *
 * Port of `ui-conversation/src/client/skeleton/ConversationSession.tsx`:
 * `Breadcrumb` (:69-73), `deriveAncestry` (:75-93), and the
 * `titleCluster > nav.crumbs` markup (:147-204). Upstream builds one crumb per
 * Session by walking `SessionSummary.parentId` while the child's `origin` is
 * `'subagent'`, prepending every summary it meets and reversing the result into
 * ancestor→current order. The last crumb is plain text (a button would drop out
 * of the header's drag row, :155-163); ancestors are buttons that open that
 * Session.
 *
 * Ancestry source — why this renders one crumb today:
 * No ARTEX Web API exposes a task parent/subagent relation. The relation only
 * exists in the backend: `db.Task.ParentRef` (`ARTEX/db/tasks.go:38`) is written
 * by the orchestration `spawn_task` tool (`ARTEX/server/orchestration.go:317-321`),
 * and the HTTP task DTO (`ARTEX/server/dto.go:32-74`, used by `GET /api/tasks`
 * and `GET /api/tasks/{id}`) does not serialize it. `web/src/lib/api.ts:278-280`
 * therefore types the task list as `Task`, and `Task` in
 * `web/src/lib/types.ts:7-54` carries no parent field. `GET /api/tasks` returns
 * `source_task_ids`, but that is read-only inherited context (a many-to-many
 * relation, `ARTEX/server/orchestration.go:248`), not a parent pointer. So
 * `deriveCrumbs` can only produce the current task; the renderer keeps the
 * upstream separator / ancestor-button / current-span structure, and exposing
 * the parent pointer on the API is the only change needed to draw a real chain.
 */
import type { ReactNode } from "react";

import clsx from "clsx";

import type { Task } from "@/lib/types";

import css from "./ConversationRoot.module.css";
import { taskTitle } from "./contract";

/** One crumb; mirrors upstream `Breadcrumb` (`ConversationSession.tsx:69-73`). */
export interface ConversationCrumb {
  readonly id: string;
  readonly displayTitle: string;
  /** Whether the Session was spawned by a subagent parent (upstream `origin`). */
  readonly subagent: boolean;
}

/**
 * Build the ancestor→current crumb chain.
 * @param task - the selected Task.
 * @returns the chain; the current task only until the API exposes a parent pointer.
 */
export function deriveCrumbs(task: Task): readonly ConversationCrumb[] {
  return [{ id: task.id, displayTitle: taskTitle(task), subagent: false }];
}

/** Props for the crumb row. */
export interface SessionCrumbsProps {
  /** The selected Task that names the current crumb. */
  readonly task: Task;
  /** Opens an ancestor Task through the shell's task selection. */
  readonly onOpenTask: (id: string) => void;
}

/**
 * Render the Session hierarchy row.
 * @param props - the selected Task and the ancestor-open callback.
 * @returns the `nav` the title cluster hosts.
 */
export function SessionCrumbs({ task, onOpenTask }: SessionCrumbsProps): ReactNode {
  const crumbs = deriveCrumbs(task);
  return (
    <nav className={css.crumbs} aria-label="会话层级">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={crumb.id} className={css.crumbSeg} data-conversation-crumb={crumb.id}>
            {/* Upstream `crumbSep` (:181): one separator between segments. */}
            {index > 0 && <span className={css.crumbSep}>/</span>}
            {last ? (
              // The current crumb has no navigation, so it is plain text rather
              // than a disabled button (upstream :155-163). `title` keeps the
              // ellipsized full name reachable.
              <span className={clsx(css.crumb, css.crumbCurrent)} title={crumb.displayTitle}>
                {crumb.displayTitle}
              </span>
            ) : (
              <button
                type="button"
                className={css.crumb}
                title={crumb.displayTitle}
                onClick={() => {
                  onOpenTask(crumb.id);
                }}
              >
                {crumb.displayTitle}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
