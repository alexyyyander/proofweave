export type PageSectionLink = {
  href: string;
  label: string;
};

export function PageSectionNav({
  links,
  label = "On this page",
  tone = "light",
}: {
  links: readonly PageSectionLink[];
  label?: string;
  tone?: "light" | "dark";
}) {
  return <nav className={`page-section-nav page-section-nav-${tone}`} aria-label={label}>
    <span>{label}</span>
    <div>{links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}</div>
  </nav>;
}
