"use client";

import { CodeBlock, SectionTitle, CardTitle } from "@/app/components/ui/primitives";

import Link from "next/link";
import { useState } from "react";
import { StepNavigation } from "@/app/components/navigation/StepNavigation";
import { useI18n } from "@/app/i18n/client";
import { pathForLocale } from "@/app/i18n/config";
import type { JourneyNode } from "./journey-evidence";
import styles from "./ShowcaseExperience.module.css";

export function ShowcaseExperience({ nodes }: { nodes: JourneyNode[] }) {
  const { t, locale } = useI18n();
  const [activeIndex, select] = useState(0);
  const active = nodes[activeIndex];
  const items = nodes.map(({ id }, index) => {
    const number = String(index + 1).padStart(2, "0");
    const label = t(`showcase.node.${id}`);
    return { id, number, label, accessibleLabel: `${number} ${label}` };
  });

  return <section className={`rh-section ${styles.root}`} id="proof-journey" aria-labelledby="showcase-journey-title">
    <SectionTitle id="showcase-journey-title">{t("showcase.title")}</SectionTitle>
    <p className={styles.intro}>{t("showcase.guide")}</p>
    <StepNavigation className={styles.steps} items={items} label={t("showcase.stepsAria")} activeIndex={activeIndex} onSelect={select} />
    <article className={styles.preview} aria-labelledby="journey-artifact">
      <div className={styles.copy} aria-live="polite" aria-atomic="true">
        <CardTitle id="journey-artifact">{t(`showcase.artifact.${active.id === "frontier" ? "target" : active.id}`)}</CardTitle>
        <p>{t(`showcase.explain.${active.id}`)}</p>
        {active.id === "receipt" && <a className="rh-link" href="#credit-rules">{t("showcase.creditRules")} ↑</a>}
        <strong data-pass={active.passed}>{active.id === "frontier" ? t("showcase.stage.frontier.state") : t(active.passed ? "showcase.state.passed" : "showcase.state.failed")}</strong>
      </div>
      <div className={styles.evidence}>
        <div>{active.id === "frontier" ? "ProofweaveFixture.lean" : t("showcase.excerpt")}</div>
        <CodeBlock key={active.id} tabIndex={0} aria-label={items[activeIndex].accessibleLabel}><code>{active.excerpt}</code></CodeBlock>
      </div>
    </article>
    <Link className="rh-link" href={pathForLocale("/demo", locale) + "#verification-console"}>{t("showcase.footer.inspect")} →</Link>
  </section>;
}
