"use client";

/**
 * mioX brand mark: an open Möbius loop, drawn with one continuous gesture.
 * Its three-dimensional turn distinguishes it from an infinity symbol at small sizes.
 */
export function MioxMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 16C12.8 11.1 8.1 6.1 5.6 10.7c-3.1 5.7 3.1 12.5 8.4 7.8l9.3-9.4c5.1-5.2 7.2 3.8 3.2 10.4-4.2 6.4-9 .3-10.5-3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 18.9c1.7-2.6 3.4-4.9 5.1-6.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
