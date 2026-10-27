"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/** Keep native Link cancellation, history, scrolling and prefetch semantics. */
export default function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationPending /></Link>;
}

function NavigationPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="navigation-pending" role="status"><span className="navigation-progress" aria-hidden="true" /><span className="navigation-status-text">Loading page…</span></span>;
}
