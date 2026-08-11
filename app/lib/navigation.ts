export type ActivePage = "home" | "showcase" | "demo" | "explore" | "how" | "history" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/", label: "Overview", page: "home" },
  { href: "/explore", label: "Research index", page: "explore" },
  { href: "/workbench", label: "My workspace", page: "workbench" },
  { href: "/about", label: "About & notes", page: "about" },
];

export const navigationGroups = [
  {
    label: "Core pages",
    items: [
      { href: "/", label: "Overview" },
      { href: "/explore", label: "Explore mathematics" },
      { href: "/workbench", label: "My workspace" },
      { href: "/about", label: "About & notes" },
    ],
  },
  {
    label: "Additional tools",
    items: [
      { href: "/reviews", label: "Verification market" },
      { href: "/receipts", label: "Contribution receipts" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/history", label: "AI mathematics record" },
      { href: "/demo", label: "Executable verified demo" },
    ],
  },
  {
    label: "Policies",
    items: [
      { href: "/about/principles", label: "Design principles" },
      { href: "/about/catalog-standard", label: "Catalog standard" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
] as const;
