/**
 * Task mode writes used by the Session-header mode menu.
 *
 * The backend models a Session's mode as **two independent task booleans**:
 * `plan_mode` (recon-only until the plan is approved, `PATCH /tasks/{id}/plan-mode`)
 * and `team_mode` (the shared task board's tools, `PATCH /tasks/{id}/team-mode`).
 * `v2/data/task-actions.ts` already forwards the plan-mode and permission-level
 * writes; this module adds the team-mode one the mode menu needs, with the same
 * contract: direct forward to `@/lib/api`, same arguments, same promise, same
 * rejection, no retry and no optimistic state here.
 */
import { api } from "@/lib/api";

/**
 * Set the task's team mode.
 * @param id - task id.
 * @param on - desired team-mode state; the backend registers the shared
 * task-board tools for the next turn only.
 * @returns the task id and its new `team_mode`.
 */
export function setTaskTeamMode(id: string, on: boolean): Promise<{ id: string; team_mode: boolean }> {
  return api.setTaskTeamMode(id, on);
}
