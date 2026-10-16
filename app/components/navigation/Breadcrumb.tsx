import { Children, cloneElement, isValidElement, type ComponentPropsWithoutRef, type ReactElement } from "react";
import { cx } from "../ui";

export function Breadcrumb({ className, children, ...props }: ComponentPropsWithoutRef<"nav">) {
  const items = Children.toArray(children);
  return <nav {...props} className={cx("breadcrumb", className)} aria-label={props["aria-label"] ?? "Breadcrumb"}>
    {items.map((item, index) => index === items.length - 1 && isValidElement(item)
      ? cloneElement(item as ReactElement<{ "aria-current"?: "page" }>, { "aria-current": "page" })
      : item)}
  </nav>;
}
