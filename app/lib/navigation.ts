export type ActivePage = "home" | "showcase" | "demo" | "explore" | "how" | "history" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/", label: "Overview", page: "home" },
  { href: "/explore", label: "Research index", page: "explore" },
  { href: "/workbench", label: "My workspace", page: "workbench" },
  { href: "/history", label: "AI mathematics record", page: "history" },
  { href: "/about", label: "About & notes", page: "about" },
];

export const navigationGroups = [
  {
    label: "Navigate",
    items: [
      { href: "/", label: "Overview" },
      { href: "/explore", label: "Research index" },
      { href: "/workbench", label: "My workspace" },
      { href: "/history", label: "AI mathematics record" },
      { href: "/about", label: "About & notes" },
    ],
  },
  {
    label: "Act on work",
    items: [
      { href: "/reviews", label: "Review queue" },
      { href: "/receipts", label: "Contribution records" },
      { href: "/demo", label: "Verified demo" },
    ],
  },
  {
    label: "Understand & trust",
    items: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/about/principles", label: "Design principles" },
      { href: "/about/catalog-standard", label: "Catalog standard" },
      { href: "/privacy", label: "Privacy & terms" },
    ],
  },
] as const;
