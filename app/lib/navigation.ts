export type ActivePage = "home" | "demo" | "explore" | "how" | "receipt" | "review" | "workbench" | "settings";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/explore", label: "Explore", page: "explore" },
  { href: "/demo", label: "Verified demo", page: "demo" },
  { href: "/how-it-works", label: "How it works", page: "how" },
];

export const footerNavigation = [
  { href: "/demo", label: "Verified demo" },
  { href: "/explore", label: "Explore" },
  { href: "/receipts", label: "Receipts" },
  { href: "/workbench", label: "Workspace" },
  { href: "/settings", label: "Settings" },
  { href: "/reviews", label: "Review queue" },
  { href: "/how-it-works", label: "How it works" },
];
