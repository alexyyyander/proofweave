"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./primitives";

export function ScrollArea({ children, className, maxHeight = 380, style, ...props }: ComponentPropsWithoutRef<"div"> & { maxHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const update = () => {
      element.style.setProperty("--fade-top", Math.min(Math.max(element.scrollTop, 0), 34) + "px");
      element.style.setProperty("--fade-bottom", Math.min(Math.max(element.scrollHeight - element.clientHeight - element.scrollTop, 0), 34) + "px");
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    resize.observe(content);
    return () => { element.removeEventListener("scroll", update); resize.disconnect(); };
  }, []);
  return <div {...props} ref={ref} className={cx("scroll-fade", className)} style={{ ...style, maxHeight }} tabIndex={props.tabIndex ?? 0}>
    <div ref={contentRef}>{children}</div>
  </div>;
}
