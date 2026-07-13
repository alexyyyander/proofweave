"use client";

import { useMemo, useState } from "react";

type IssuedToken = {
  expiresAt: string;
  name: string;
  token: string;
  tokenPrefix: string;
};

export function IntegrationClient({ ownerEmail }: { ownerEmail: string }) {
  const [name, setName] = useState("Codex on this device");
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const config = useMemo(() => {
    if (!issued || typeof window === "undefined") return "";

    return JSON.stringify(
      {
        mcpServers: {
          proofweave: {
            command: "node",
            args: ["/absolute/path/to/proofweave/services/proofweave-mcp/index.mjs"],
            env: {
              PROOFWEAVE_BASE_URL: window.location.origin,
              PROOFWEAVE_API_TOKEN: issued.token,
            },
          },
        },
      },
      null,
      2,
    );
  }, [issued]);

  async function issueToken() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/mcp/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, expiresInDays: 30 }),
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        token?: IssuedToken;
      };

      if (!response.ok || !body.token) {
        throw new Error(body.error?.message ?? "Could not issue an MCP token.");
      }

      setIssued(body.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not issue an MCP token.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="integration-grid" aria-label="Codex MCP connection">
      <article className="integration-card">
        <span className="micro-label">01 / Personal access</span>
        <h2>Issue a scoped token</h2>
        <p>
          This token belongs to <code>{ownerEmail}</code>. It can read the
          public frontier catalog and write only your own provisional attempt
          events.
        </p>
        <label className="integration-field">
          <span>Connection name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            required
          />
        </label>
        <button
          className="button button-primary"
          type="button"
          onClick={issueToken}
          disabled={isSubmitting || name.trim().length === 0}
        >
          {isSubmitting ? "Issuing token…" : "Create 30-day token"}
        </button>
        {error ? <p className="integration-error" role="alert">{error}</p> : null}
      </article>

      <article className="integration-card integration-card-dark">
        <span className="micro-label">02 / Local Codex config</span>
        <h2>Keep the token on your machine.</h2>
        {issued ? (
          <>
            <p className="integration-success">Token created for {issued.name}. It expires {new Date(issued.expiresAt).toLocaleDateString()} and will not be displayed again after you leave this page.</p>
            <pre className="integration-config"><code>{config}</code></pre>
          </>
        ) : (
          <p>After creating a token, copy the generated configuration into your local Codex MCP settings. The bridge is included in this repository under <code>services/proofweave-mcp</code>.</p>
        )}
        <p className="integration-note">
          Agent-reported progress is not Lean verification, an independent
          review, or a contribution receipt. The current private hosted alpha
          is owner-only; wider participant access needs a separate control API
          deployment.
        </p>
      </article>
    </section>
  );
}
