"use client";

import { SectionTitle, Field, ActionLink, Button, FieldList, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import compatibilityContract from "@/packages/protocol/proofweave-client-compatibility.json";
import { CodexConnectPrompt, CodexInstallPrompt, CodexSetupPrompt, CodexWorkflowPrompt } from "./CodexInstallPrompt";
import { integrationRefreshHref } from "@/packages/protocol/integration-return-href.mjs";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey } from "@/app/i18n/translate";

const authorizedScopeKeys: readonly TranslationKey[] = [
  "integrations.scopes.catalog",
  "integrations.scopes.attempts",
  "integrations.scopes.progress",
  "integrations.scopes.bound",
  "integrations.scopes.bundle",
  "integrations.scopes.runner",
  "integrations.scopes.reviews",
  "integrations.scopes.attestation",
];

type SelectedTarget = Readonly<{
  slug: string;
  title: string;
  domain: string;
  informalStatement: string;
}>;

export function IntegrationClient({
  connection,
  isAuthenticated,
  signInHref,
  googleSignInAvailable,
  controlPlaneWritesEnabled,
  selectedTarget,
  returnHref,
}: {
  connection: { agentLabel: string } | null;
  isAuthenticated: boolean;
  signInHref: string;
  googleSignInAvailable: boolean;
  controlPlaneWritesEnabled: boolean;
  selectedTarget: SelectedTarget | null;
  returnHref: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [watchingConnection, setWatchingConnection] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const pageHref = integrationRefreshHref({
    targetSlug: selectedTarget?.slug,
    returnHref,
  });

  useEffect(() => {
    if (connection || !watchingConnection) return;
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;

    const check = async () => {
      attempts += 1;
      try {
        const response = await fetch("/api/me/workspace-summary", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.summary?.agent?.connected) {
          if (!cancelled) {
            setConnectionNotice(t("integrations.notice.approved"));
            router.replace(returnHref);
          }
          return;
        }
        if (!cancelled) {
          setConnectionNotice(response.status === 401
            ? t("integrations.notice.signIn")
            : t("integrations.notice.waiting"));
        }
      } catch {
        if (!cancelled) setConnectionNotice(t("integrations.notice.record"));
      }
      if (!cancelled && attempts < 120) timer = window.setTimeout(check, 2500);
    };

    void check();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [connection, returnHref, router, t, watchingConnection]);

  return <>
    {selectedTarget && <section className="integration-target-context" aria-label={t("integrations.target.aria")}>
      <div>
        <span className="micro-label">{t("integrations.target.label", { domain: selectedTarget.domain })}</span>
        <strong>{selectedTarget.title}</strong>
        <p>{selectedTarget.informalStatement}</p>
      </div>
      <div>
        <span>{t("integrations.target.kept")}</span>
        <Link href={`/explore/${selectedTarget.slug}`}>{t("integrations.target.inspect")} <span aria-hidden="true">→</span></Link>
      </div>
    </section>}

    <section className="integration-grid integration-entry-grid" aria-label={t("integrations.entry.aria")}>
      <Surface as="article" className="integration-card integration-card-dark integration-primary-card integration-card-wide" id="codex-beta">
        <span className="micro-label">{connection ? t("integrations.entry.authorized") : isAuthenticated ? t("integrations.entry.setup") : t("integrations.entry.signInFirst")}</span>
        <SectionTitle>{connection ? t("integrations.entry.connectedTitle", { agent: connection.agentLabel }) : t("integrations.entry.connectTitle")}</SectionTitle>
        <p>{connection
          ? t("integrations.entry.connectedBody")
          : isAuthenticated
            ? t("integrations.entry.setupBody")
            : t("integrations.entry.signInBody")}</p>

        <ol className="integration-flow integration-flow-compact" aria-label={t("integrations.flow.aria")}>
          <li><b>{selectedTarget ? "✓" : "1"}</b><span><strong>{t("integrations.flow.choose")}</strong> {selectedTarget ? t("integrations.flow.chooseSelected", { title: selectedTarget.title }) : t("integrations.flow.chooseBody")}</span></li>
          <li><b>{connection ? "✓" : "2"}</b><span><strong>{t("integrations.flow.authorize")}</strong> {connection ? t("integrations.flow.authorizeConnected") : t("integrations.flow.authorizeBody")}</span></li>
          <li><b>3</b><span><strong>{t("integrations.flow.return")}</strong> {t("integrations.flow.returnBody")}</span></li>
        </ol>

        {!controlPlaneWritesEnabled && <div className="integration-connect-action" role="status">
          <strong>{t("integrations.maintenance.title")}</strong>
          <p>{t("integrations.maintenance.body")}</p>
        </div>}

        {connection ? <div className="integration-connected-callout integration-connected-callout-dark">
          <strong>{controlPlaneWritesEnabled
            ? selectedTarget ? t("integrations.connected.targetReady", { title: selectedTarget.title }) : t("integrations.connected.recordReady")
            : t("integrations.connected.readable")}</strong>
          <p>{controlPlaneWritesEnabled
            ? selectedTarget ? t("integrations.connected.targetBody") : t("integrations.connected.recordBody")
            : t("integrations.connected.readableBody")}</p>
          <ActionLink className="button button-primary" href={returnHref}>{controlPlaneWritesEnabled
            ? selectedTarget ? t("integrations.action.returnTarget") : t("integrations.action.openWorkspace")
            : t("integrations.action.viewWorkspace")} <span aria-hidden="true">→</span></ActionLink>
        </div> : !controlPlaneWritesEnabled ? <Button className="button button-primary" type="button" disabled>{t("integrations.action.paused")}</Button> : !isAuthenticated ? <div className="integration-connect-action">
          <ActionLink className="button button-primary" href={signInHref}>{t("integrations.action.continueChatGPT")} <span aria-hidden="true">→</span></ActionLink>
          <p>{t(googleSignInAvailable ? "integrations.action.googleAvailable" : "integrations.action.googleUnavailable")}</p>
        </div> : <div className="integration-connect-action">
          <CodexSetupPrompt targetTitle={selectedTarget?.title} returnHref={returnHref} onRequestCopied={() => setWatchingConnection(true)} />
          <p>{t("integrations.action.pastePrompt")}</p>
          {connectionNotice && <p className="integration-connection-notice" aria-live="polite">{connectionNotice}</p>}
          <div className="integration-inline-links">
            <Link href={pageHref}>{t("integrations.action.refresh")} <span aria-hidden="true">↻</span></Link>
          </div>
        </div>}

        <div className="integration-inline-links">
          <Link href="/explore">{t("integrations.action.browseFirst")} <span aria-hidden="true">→</span></Link>
        </div>
        <p className="integration-note">{t("integrations.note", { google: t(googleSignInAvailable ? "integrations.note.googleAvailable" : "integrations.note.googleUnavailable") })}</p>
      </Surface>

      <Surface as="article" className="integration-card integration-card-wide integration-advanced-card">
        <span className="micro-label">{t("integrations.advanced.label")}</span>
        <SectionTitle>{t("integrations.advanced.title")}</SectionTitle>
        <div className="integration-disclosures">
          <details>
            <summary>{t("integrations.install.missing")}</summary>
            <p>{t("integrations.install.body")}</p>
            <CodexInstallPrompt />
            <details className="integration-command-details">
              <summary>{t("integrations.install.steps")}</summary>
              <code>Download /downloads/proofweave-research-marketplace.tar and its .sha256 file</code>
              <code>shasum -a 256 -c proofweave-research-marketplace.tar.sha256</code>
              <code>tar -xf proofweave-research-marketplace.tar -C &quot;$PROOFWEAVE_MARKETPLACE_DIR&quot;</code>
              <code>codex plugin marketplace add &quot;$PROOFWEAVE_MARKETPLACE_DIR&quot;</code>
              <code>codex plugin add proofweave-research@proofweave-private-beta</code>
            </details>
            <div className="integration-status integration-status-ready"><i aria-hidden="true" />{t("integrations.install.ready")}</div>
          </details>
          <details>
            <summary>{t("integrations.update.summary")}</summary>
            <div className="integration-update-policy" aria-label={t("integrations.update.aria")}>
              <div>
                <span className="micro-label">{t("integrations.update.live")}</span>
                <strong>{t("integrations.update.current", { api: compatibilityContract.connectorApiVersion, schema: compatibilityContract.toolSchemaVersion })}</strong>
              </div>
              <FieldList>
                <Field label={t("integrations.update.normal")}>{t("integrations.update.normalValue")}</Field>
                <Field label={t("integrations.update.plugin")}>{t("integrations.update.pluginValue")}</Field>
                <Field label={t("integrations.update.reinstall")}>{t("integrations.update.reinstallValue")}</Field>
              </FieldList>
              <p>{t("integrations.update.body")}</p>
            </div>
          </details>
          <details>
            <summary>{t("integrations.scopes.summary")}</summary>
            <div className="integration-scopes" aria-label={t("integrations.scopes.aria")}>
              {authorizedScopeKeys.map((scope) => <span key={scope}>{t(scope)}</span>)}
            </div>
          </details>
          <details id="review-agent">
            <summary>{t("integrations.review.summary")}</summary>
            <p>{t("integrations.review.body")}</p>
            <div className="codex-install-actions"><CodexConnectPrompt role="review" returnHref="/reviews" /><CodexWorkflowPrompt workflow="review_queue" /></div>
          </details>
          {connection && <details>
            <summary>{t("integrations.submission.summary")}</summary>
            <p>{t("integrations.submission.body")}</p>
            <CodexWorkflowPrompt workflow="research_submission" />
          </details>}
          <details>
            <summary>{t("integrations.legacy.summary")}</summary>
            <p>{t("integrations.legacy.body")}</p>
          </details>
        </div>
        <div className="integration-card-links">
          <Link className="text-link" href={connection ? "/settings#delegation-setup" : "/settings"}>{t("integrations.links.settings")} <span>→</span></Link>
          <a className="text-link" href="/codex-install.md" target="_blank" rel="noreferrer">{t("integrations.links.guide")} <span>→</span></a>
          <Link className="text-link" href="/privacy">{t("integrations.links.privacy")} <span>→</span></Link>
        </div>
      </Surface>
    </section>
  </>;
}
