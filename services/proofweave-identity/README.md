# Proofweave Identity

This Worker-compatible service owns OAuth discovery and authorization for the
remote Proofweave MCP resource. It intentionally does not reuse the Sites
frontend's owner-only ChatGPT identity or expose its bypass credentials.

The checked-in default is a deliberately unavailable adapter: it publishes
OAuth metadata but returns `503` from authorization, token, and registration
endpoints. Replace it with a production identity adapter before deploying it to
participants.
