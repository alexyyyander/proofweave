import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cx } from "./primitives";

type PaperSurfaceProps = Omit<ComponentPropsWithoutRef<"article">, "title"> & {
  heading: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  /** Change only when the displayed document changes. */
  pageKey?: string;
  stacked?: boolean;
  bodyClassName?: string;
};
export function PaperSurface({ heading, meta, footer, pageKey, stacked = true, bodyClassName, className, children, ...props }: PaperSurfaceProps) {
  return <div className={cx("ui-paper-stack", !stacked && "ui-paper-single")}>
    <article {...props} key={pageKey} className={cx("ui-paper", className)}>
      <header className="ui-paper-heading"><span>{heading}</span>{meta && <span className="ui-paper-meta">{meta}</span>}</header>
      <div className={cx("ui-paper-body", bodyClassName)}>{children}</div>
      {footer && <footer className="ui-paper-footer">{footer}</footer>}
    </article>
  </div>;
}
