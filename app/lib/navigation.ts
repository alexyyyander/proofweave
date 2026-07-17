export type ActivePage = "home" | "showcase" | "demo" | "explore" | "how" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/explore", label: "Explore", page: "explore" },
  { href: "/how-it-works", label: "How it works", page: "how" },
  { href: "/about", label: "About", page: "about" },
];

export const navigationGroups = [
  {
    label: "Participate",
    items: [
      { href: "/explore", label: "Explore mathematics" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/showcase", label: "Proof journey" },
      { href: "/demo", label: "Verified demo" },
    ],
  },
  {
    label: "Trust",
    items: [
      { href: "/about", label: "About Proofweave" },
      { href: "/about/principles", label: "Design principles" },
      { href: "/about/catalog-standard", label: "Catalog standard" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/workbench", label: "Research" },
      { href: "/reviews", label: "Reviews" },
      { href: "/receipts", label: "Receipts" },
      { href: "/profile", label: "Profile" },
      { href: "/settings", label: "Settings" },
    ],
  },
] as const;
