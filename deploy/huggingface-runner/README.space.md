---
title: Proofweave Trusted Runner
emoji: 🧶
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# Proofweave Trusted Runner

This private Space coordinates signed Proofweave Runner queue leases. It does
not execute submitted Lean code. Every workspace executes inside a fresh E2B
Sandbox with public traffic and outbound network access disabled.

The root page and `/healthz` expose privacy-safe service state. `/v1/wake`
accepts an authenticated wake request from the Proofweave control plane.
