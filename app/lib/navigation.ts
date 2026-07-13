export type ActivePage = "home" | "explore" | "how" | "receipt" | "workbench";

export const primaryNavigation: Array<{ href: string; label: string; page: ActivePage }> = [
  { href: "/explore", label: "Explore", page: "explore" },
  { href: "/how-it-works", label: "How it works", page: "how" },
  { href: "/workbench", label: "Workbench", page: "workbench" },
];

export const footerNavigation = [
  { href: "/explore", label: "Explore" },
  { href: "/workbench", label: "Workbench" },
  { href: "/how-it-works", label: "Protocol" },
  { href: "/how-it-works", label: "Receipt requirements" },
];
