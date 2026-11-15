/**
 * Bottom-follow policy for the chat scrollport.
 *
 * Ported from the reference harness (`dsh-client-ui-chat/src/client/chat/use-scroll-follow.ts`)
 * so the streaming behaviour matches: follow intent is independent state, "near the
 * bottom" is a 24px tolerance, and a native smooth scroll is retargeted instead of
 * being cut short when content grows under it.
 *
 * No React, no DOM observers - callers feed measurements in.
 */

/** Accepted distance from the floor, in pixels (same value as the reference). */
export const FOLLOW_THRESHOLD = 24;

/** Scroll position, floor (max scrollTop) and viewport height. */
export interface ViewportMetrics {
  readonly top: number;
  readonly floor: number;
  readonly height: number;
}

/** Read one scrollport without measuring its children. */
export function scrollMetrics(element: HTMLElement): ViewportMetrics {
  const height = element.clientHeight;
  return { top: element.scrollTop, height, floor: Math.max(0, element.scrollHeight - height) };
}

/** One scrollport's follow intent. Native animation progress is not reader movement. */
export class ScrollFollow {
  private target: number | null = null;
  private sampledTop: number | undefined;

  constructor(private following: boolean) {}

  /** Whether content growth should keep the floor in view. */
  get active(): boolean {
    return this.following;
  }

  /** Whether a native follow animation has an outstanding target. */
  get animating(): boolean {
    return this.target !== null;
  }

  /** Whether the position is within the follow threshold of the floor. */
  nearBottom(metrics: ViewportMetrics): boolean {
    return Math.abs(metrics.floor - metrics.top) <= FOLLOW_THRESHOLD;
  }

  /** Commit an externally decided follow intent without moving the scrollport. */
  setFollowing(active: boolean): void {
    this.following = active;
    if (!active) this.target = null;
  }

  /** Adopt the next visible layout as a fresh reader position (session/lane switch). */
  reset(): void {
    this.setFollowing(false);
    this.sampledTop = undefined;
  }

  /**
   * Adopt delivered scrolling while retaining intent during native animation.
   * `movedByReader` is attributed by the caller; when omitted it is inferred from
   * the distance moved since the previous sample.
   */
  sample(metrics: ViewportMetrics, movedByReader = this.sampledTop === undefined || Math.abs(metrics.top - this.sampledTop) > 0.5): boolean {
    this.sampledTop = metrics.top;
    if (!this.animating && movedByReader) this.following = this.nearBottom(metrics);
    return this.active;
  }

  /** Settle native scrolling; an off-target stop releases follow intent. */
  settle(metrics: ViewportMetrics): boolean {
    const target = this.target;
    this.target = null;
    return this.sample(metrics, target === null ? undefined : Math.abs(metrics.top - Math.min(target, metrics.floor)) > FOLLOW_THRESHOLD);
  }

  /** Position immediately and adopt the resulting follow intent. */
  jump(element: HTMLElement, metrics: ViewportMetrics, top: number): ViewportMetrics {
    const animated = this.animating;
    this.target = null;
    const target = Math.max(0, Math.min(metrics.floor, top));
    if (animated) element.scrollTo({ top: target, behavior: "instant" });
    else if (target !== metrics.top) element.scrollTop = target;
    const landed = { ...metrics, top: element.scrollTop };
    this.sampledTop = landed.top;
    this.following = this.nearBottom(landed);
    return landed;
  }

  /**
   * Follow the measured floor, respecting reduced motion for smooth requests.
   *
   * - already at the floor → jump (cheap, no animation)
   * - instant while an animation is outstanding → retarget it instead of cutting
   * - instant, or a smooth request that is already near the bottom → jump
   * - reduced motion → jump
   * - otherwise start (or keep) one smooth animation to the floor
   */
  toBottom(element: HTMLElement, metrics: ViewportMetrics, behavior: "instant" | "smooth"): ViewportMetrics {
    this.following = true;
    if (metrics.top === metrics.floor) return this.jump(element, metrics, metrics.floor);
    if (behavior === "instant" && this.animating) {
      // Content grew under an outstanding animation: retarget it instead of cutting to the floor.
      if (this.target !== metrics.floor) {
        this.target = metrics.floor;
        element.scrollTo({ top: metrics.floor, behavior: "smooth" });
      }
      return metrics;
    }
    if (behavior === "instant" || (!this.animating && this.nearBottom(metrics))) return this.jump(element, metrics, metrics.floor);
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return this.jump(element, metrics, metrics.floor);
    }
    if (this.target === null) {
      this.target = metrics.floor;
      element.scrollTo({ top: metrics.floor, behavior: "smooth" });
    }
    return metrics;
  }

  /** Cancel native motion before a reader gesture; only actual movement changes intent. */
  interrupt(element: HTMLElement, metrics: ViewportMetrics): void {
    this.target = null;
    element.scrollTop = metrics.top;
  }
}
