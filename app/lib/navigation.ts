export type ActivePage = "home" | "showcase" | "demo" | "explore" | "how" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/showcase", label: "Showcase", page: "showcase" },
  { href: "/explore", label: "Explore", page: "explore" },
  { href: "/how-it-works", label: "How to participate", page: "how" },
  { href: "/about", label: "Trust & principles", page: "about" },
];

export const footerNavigation = [
  { href: "/showcase", label: "Proof journey" },
  { href: "/demo", label: "Verified demo" },
  { href: "/explore", label: "Explore" },
  { href: "/receipts", label: "Receipts" },
  { href: "/profile", label: "My profile" },
  { href: "/workbench", label: "Workspace" },
  { href: "/settings", label: "Settings" },
  { href: "/reviews", label: "Review queue" },
  { href: "/how-it-works", label: "How to participate" },
  { href: "/about", label: "Trust & principles" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];
