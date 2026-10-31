import { createElement, type ComponentPropsWithRef, type ReactNode } from "react";

export function cx(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "quiet";
  busy?: boolean;
};
export function Button({ className, variant, busy = false, disabled, children, ...props }: ButtonProps) {
  return <button {...props} className={cx("ui-button", variant && "button", variant && "button-" + variant, className)}
    disabled={disabled || busy} aria-busy={busy || props["aria-busy"]}>
    {children}
  </button>;
}

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input {...props} className={cx("ui-input", className)} />;
}
export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return <select {...props} className={cx("ui-select", className)} />;
}
export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={cx("ui-textarea", className)} />;
}

export function FieldList({ className, children, layout = "rows", ...props }: ComponentPropsWithRef<"dl"> & { layout?: "rows" | "stacked" }) {
  return <dl {...props} className={cx("ui-fields", layout === "stacked" && "ui-fields-stacked", className)}>{children}</dl>;
}
export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={className}><dt>{label}</dt><dd>{children}</dd></div>;
}

export function CodeBlock({ className, ...props }: ComponentPropsWithRef<"pre">) {
  return <pre {...props} className={cx("ui-code", className)} />;
}

type SurfaceProps = ComponentPropsWithRef<"section"> & {
  as?: "section" | "article" | "div" | "aside";
  tone?: "plain" | "card" | "inset";
};
export function Surface({ as: Tag = "section", tone = "plain", className, ...props }: SurfaceProps) {
  return createElement(Tag, { ...props, className: cx("ui-surface", "ui-surface-" + tone, className) });
}

type HeadingProps = ComponentPropsWithRef<"section"> & {
  as?: "section" | "div" | "header";
};
export function SectionHeading({ as: Tag = "section", className, ...props }: HeadingProps) {
  return createElement(Tag, { ...props, className: cx("ui-section-heading", className) });
}

export function EmptyState({ as: Tag = "section", className, ...props }: HeadingProps) {
  return createElement(Tag, { ...props, className: cx("ui-empty-state", className) });
}

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

export function Badge({ className, tone = "neutral", ...props }: ComponentPropsWithRef<"span"> & {
  tone?: "neutral" | "positive" | "warning" | "negative";
}) {
  return <span {...props} className={cx("ui-badge", className)} data-tone={tone} />;
}

/** Section-level heading; page titles belong to PageIntro. */
export function SectionTitle({ as: Tag = "h2", className, ...props }: ComponentPropsWithRef<"h2"> & { as?: "h2" | "h3" }) {
  return createElement(Tag, { ...props, className: cx("ui-section-title", className) });
}

/** Card title styling is independent of its place in the document outline. */
export function CardTitle({ as: Tag = "h3", className, ...props }: ComponentPropsWithRef<"h3"> & { as?: "h2" | "h3" | "h4" }) {
  return createElement(Tag, { ...props, className: cx("ui-card-title", className) });
}

/** Page title for detail and task layouts that do not use PageIntro. */
export function PageTitle({ className, ...props }: ComponentPropsWithRef<"h1">) {
  return <h1 {...props} className={cx("ui-page-title", className)} />;
}
