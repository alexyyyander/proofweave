"use client";

import { useRef, type ReactNode } from "react";
import { Button, cx } from "../ui";

export type NavigationStep = { id: string; label: ReactNode; accessibleLabel: string; number?: string; meta?: ReactNode };
export function StepNavigation({ items, activeIndex, onSelect, label, className, buttonClassName }: {
  items: readonly NavigationStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
  label: string;
  className?: string;
  buttonClassName?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return <ol className={cx("ui-steps", className)} aria-label={label}>
    {items.map((item, index) => <li key={item.id}>
      <Button type="button" ref={(element) => { refs.current[index] = element; }}
        className={cx(buttonClassName, index === activeIndex && "is-active")}
        aria-current={index === activeIndex ? "step" : undefined}
        aria-label={item.accessibleLabel} data-reached={index <= activeIndex}
        onClick={() => onSelect(index)}
        onKeyDown={(event) => {
          let next: number;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % items.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = items.length - 1;
          else return;
          event.preventDefault();
          onSelect(next);
          refs.current[next]?.focus();
        }}>
        {item.number && <span>{item.number}</span>}{item.label}{item.meta}
      </Button>
    </li>)}
  </ol>;
}
