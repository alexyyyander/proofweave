import { type ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { type ActivePage } from "@/app/lib/navigation";

export function SiteFrame({ active, activeHref, className = "site-shell app-shell", mainClassName, children }: {
  active: ActivePage;
  activeHref?: string;
  className?: string;
  mainClassName?: string;
  children: ReactNode;
}) {
  return <div className={`ui-site-frame ${className}`}>
    <Header active={active} activeHref={activeHref} />
    <main id="main-content" tabIndex={-1} className={mainClassName}>{children}</main>
    <Footer />
  </div>;
}
