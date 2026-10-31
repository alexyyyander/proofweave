import type { TranslationKey } from "@/app/i18n/dictionaries/en";

export type ActivePage = "none" | "home" | "showcase" | "demo" | "explore" | "publications" | "how" | "history" | "about" | "profile" | "receipt" | "review" | "workbench" | "settings";

export type PrimaryNavigationItem = { href: string; labelKey: TranslationKey; page: ActivePage };
export type NavigationItem = { href: string; labelKey: TranslationKey };

export const primaryNavigation: readonly PrimaryNavigationItem[] = [
  { href: "/", labelKey: "nav.primary.overview", page: "home" },
  { href: "/explore", labelKey: "nav.primary.research", page: "explore" },
  { href: "/workbench", labelKey: "nav.primary.workspace", page: "workbench" },
  { href: "/history", labelKey: "nav.primary.aiRecord", page: "history" },
  { href: "/about", labelKey: "nav.primary.about", page: "about" },
];

export const navigationGroups: readonly { labelKey: TranslationKey; items: readonly NavigationItem[] }[] = [
  {
    labelKey: "nav.group.core",
    items: [
      { href: "/", labelKey: "nav.primary.overview" },
      { href: "/explore", labelKey: "nav.primary.research" },
      { href: "/workbench", labelKey: "nav.primary.workspace" },
      { href: "/history", labelKey: "nav.primary.aiRecord" },
      { href: "/about", labelKey: "nav.primary.about" },
    ],
  },
  {
    labelKey: "nav.group.researchTools",
    items: [
      { href: "/publications", labelKey: "nav.item.publications" },
      { href: "/reviews", labelKey: "nav.item.reviewQueue" },
      { href: "/reviewers", labelKey: "nav.item.reviewers" },
      { href: "/receipts", labelKey: "nav.item.contributionRecords" },
      { href: "/demo", labelKey: "nav.item.verification" },
    ],
  },
  {
    labelKey: "nav.group.reference",
    items: [
      { href: "/how-it-works", labelKey: "nav.item.howItWorks" },
      { href: "/about/principles", labelKey: "nav.item.principles" },
      { href: "/about/catalog-standard", labelKey: "nav.item.catalogStandard" },
      { href: "/privacy", labelKey: "nav.item.privacy" },
      { href: "/terms", labelKey: "nav.item.terms" },
      { href: "/support", labelKey: "nav.item.support" },
    ],
  },
];
