"use client";

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
    <h2 id="showcase-journey-title">{t("showcase.title")}</h2>
    <p className={styles.intro}>{t("showcase.guide")}</p>
    <StepNavigation className={styles.steps} items={items} label={t("showcase.stepsAria")} activeIndex={activeIndex} onSelect={select} />
    <article className={styles.preview} aria-labelledby="journey-artifact">
      <div className={styles.copy} aria-live="polite" aria-atomic="true">
        <h3 id="journey-artifact">{t(`showcase.artifact.${active.id === "frontier" ? "target" : active.id}`)}</h3>
        <p>{t(`showcase.explain.${active.id}`)}</p>
        <strong data-pass={active.passed}>{active.id === "frontier" ? t("showcase.stage.frontier.state") : t(active.passed ? "showcase.state.passed" : "showcase.state.failed")}</strong>
      </div>
      <div className={styles.evidence}>
        <div>{active.id === "frontier" ? "ProofweaveFixture.lean" : t("showcase.excerpt")}</div>
        <pre key={active.id} tabIndex={0} aria-label={items[activeIndex].accessibleLabel}><code>{active.excerpt}</code></pre>
      </div>
    </article>
    <Link className="rh-link" href={pathForLocale("/demo", locale) + "#verification-console"}>{t("showcase.footer.inspect")} →</Link>
  </section>;
}
