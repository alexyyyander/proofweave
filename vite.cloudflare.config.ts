import vinext from "vinext";
import { defineConfig } from "vite";

// Build a direct Worker independently of the Sites packaging integration.
export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [vinext(), cloudflare({
      configPath: "wrangler.cloudflare.jsonc",
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    })],
  };
});
