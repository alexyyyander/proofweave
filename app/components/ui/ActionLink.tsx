import Link from "next/link";
import { type ComponentProps } from "react";
import { cx } from "./primitives";

export function ActionLink({ variant, className, ...props }: ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  return <Link {...props} className={cx("ui-action-link", variant && "button", variant && "button-" + variant, className)} />;
}
