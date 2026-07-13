export type ActivePage = "home" | "explore" | "how" | "receipt" | "review" | "workbench";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/explore", label: "Explore", page: "explore" },
  { href: "/reviews", label: "Review", page: "review" },
  { href: "/how-it-works", label: "How it works", page: "how" },
  { href: "/workbench", label: "Workbench", page: "workbench" },
];

export const footerNavigation = [
  { href: "/explore", label: "Explore" },
  { href: "/receipts", label: "Receipts" },
  { href: "/workbench", label: "Workbench" },
  { href: "/reviews", label: "Review queue" },
  { href: "/how-it-works", label: "Protocol" },
  { href: "/how-it-works", label: "Receipt requirements" },
];
