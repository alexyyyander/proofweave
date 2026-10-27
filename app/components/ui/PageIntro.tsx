import { type ReactNode } from "react";
import { PageTitle } from "./primitives";

/** The entry hierarchy for a page. Route layouts do not own title typography. */
export function PageIntro({ label, title, description, actions, meta, aside, children, id, titleId = "page-title", tone = "paper" }: {
  label: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  id?: string;
  titleId?: string;
  tone?: "paper" | "navy";
}) {
  return <section className="page-intro" data-tone={tone} id={id} aria-labelledby={titleId}>
    <div className="page-intro__layout">
      <div className="page-intro__copy">
        <p className="page-intro__label">{label}</p>
        <PageTitle className="page-intro__title" id={titleId}>{title}</PageTitle>
        <p className="page-intro__description">{description}</p>
        {actions && <div className="page-intro__actions">{actions}</div>}
        {meta && <div className="page-intro__meta">{meta}</div>}
        {children}
      </div>
      {aside && <aside className="page-intro__aside">{aside}</aside>}
    </div>
  </section>;
}
