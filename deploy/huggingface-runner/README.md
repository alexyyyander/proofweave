# Hugging Face Runner deployment

This target packages the trusted Proofweave queue coordinator as a private
Hugging Face Docker Space. Free CPU Basic is enough because untrusted Lean
execution remains in E2B.

## Export an auditable Space repository

```sh
npm run runner:huggingface:export -- /tmp/proofweave-hf-space
```

The export contains only the runtime dependency graph: protocol packages,
artifact/database/Runner/verification services, a minimal dependency lockfile,
the Dockerfile, and the Space README.

## Required Space secrets

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `E2B_API_KEY`
- `RUNNER_RESULT_PRIVATE_KEY_JWK`
- `PROOFWEAVE_RUNNER_WAKE_TOKEN`

## Required Space variables

- `RUNNER_EXECUTION_ENABLED=true`
- `RUNNER_CONSUMER_ID=runner:huggingface-alpha`
- `PROOFWEAVE_RUNNER_PROVIDER=e2b`
- `RUNNER_RESULT_KEY_ID`
- `RUNNER_APPROVED_IMAGES_JSON`
- `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON`
- `PROOFWEAVE_E2B_TEMPLATE_ID`
- `PROOFWEAVE_E2B_TEMPLATE_BUILD_ID`
- `PROOFWEAVE_E2B_RUNNER_IMAGE`
- `PROOFWEAVE_E2B_CPU`
- `PROOFWEAVE_E2B_MEMORY_MB`
- `PROOFWEAVE_E2B_TIMEOUT_MS`
- `PROOFWEAVE_E2B_STARTUP_TIMEOUT_MS`
- `PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED=true`
- `PROOFWEAVE_RUNNER_REVISION`

`RUNNER_APPROVED_IMAGES_JSON` must contain exactly the same immutable image
digest as `PROOFWEAVE_E2B_RUNNER_IMAGE`. The result key's public half must be
enrolled by the Proofweave control plane before execution is enabled.
