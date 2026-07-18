export type ActivePage = "home" | "showcase" | "demo" | "explore" | "how" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/explore", label: "Explore", page: "explore" },
  { href: "/reviews", label: "Verify", page: "review" },
  { href: "/receipts", label: "Contributions", page: "receipt" },
  { href: "/how-it-works", label: "How it works", page: "how" },
];

export const navigationGroups = [
  {
    label: "Participate",
    items: [
      { href: "/explore", label: "Explore mathematics" },
      { href: "/reviews", label: "Verification market" },
      { href: "/receipts", label: "Contribution receipts" },
    ],
  },
  {
    label: "Learn",
    items: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/#proof-journey", label: "Proof journey" },
      { href: "/demo", label: "Executable verified demo" },
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
] as const;
