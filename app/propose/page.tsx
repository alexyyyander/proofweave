import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionHeading } from "@/app/components/ui";
import Link from "next/link";
import { requireUser } from "@/app/auth";

import { ProblemProposalClient } from "./ProblemProposalClient";
import { getI18n } from "@/app/i18n/server";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("propose.metaTitle"), description: t("propose.metaDescription") };
}

export default async function ProposePage() {
  const { t } = await getI18n();
  await requireUser("/propose");
  return <SiteFrame className="site-shell app-shell" active="explore" mainClassName="page-main proposal-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{t("propose.breadcrumb")}</span></Breadcrumb>
      <SectionHeading as="section" className="page-hero proposal-hero">
        <p className="eyebrow">{t("propose.eyebrow")}</p>
        <PageTitle>{t("propose.title")}</PageTitle>
        <p>{t("propose.body")}</p>
        <div className="hero-facts"><span>{t("propose.fact.propose")}</span><span>{t("propose.fact.curate")}</span><span>{t("propose.fact.open")}</span></div>
      </SectionHeading>
      <ProblemProposalClient />
    </SiteFrame>;
}
