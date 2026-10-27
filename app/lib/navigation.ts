export type ActivePage = "none" | "home" | "showcase" | "demo" | "explore" | "publications" | "how" | "history" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/", label: "Overview", page: "home" },
  { href: "/explore", label: "Research", page: "explore" },
  { href: "/workbench", label: "Workspace", page: "workbench" },
  { href: "/history", label: "AI record", page: "history" },
  { href: "/about", label: "About", page: "about" },
];

export const navigationGroups = [
  {
    label: "Core pages",
    items: [
      { href: "/", label: "Overview" },
      { href: "/explore", label: "Research" },
      { href: "/workbench", label: "Workspace" },
      { href: "/history", label: "AI record" },
      { href: "/about", label: "About" },
    ],
  },
  {
    label: "Research tools",
    items: [
      { href: "/publications", label: "Publications" },
      { href: "/reviews", label: "Review queue" },
      { href: "/reviewers", label: "Reviewers" },
      { href: "/receipts", label: "Contribution records" },
      { href: "/demo", label: "Verification" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/about/principles", label: "Principles" },
      { href: "/about/catalog-standard", label: "Catalog standard" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/support", label: "Support" },
    ],
  },
] as const;
