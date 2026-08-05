import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults are fine here: no R2/KV/D1 incremental-cache bindings configured
// (see wrangler.jsonc), so Next.js's cache falls back to in-memory per
// isolate — acceptable for this app's traffic. Revisit if ISR/ full route
// caching across isolates becomes worth the extra binding.
export default defineCloudflareConfig();
