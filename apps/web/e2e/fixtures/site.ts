/**
 * A tiny "customer website" for migration tests: serves the REAL posthog-js bundle
 * (from node_modules) and initialises it with api_host pointing at HostPog.
 *   /?token=phc_…&api=http://localhost:3001/ph&run=<id>&event=<name>
 * Port 4030.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import path from "node:path";

const require = createRequire(import.meta.url);
const bundle = readFileSync(path.join(path.dirname(require.resolve("posthog-js/package.json")), "dist/array.full.js"));
const PORT = Number(process.env.SITE_PORT ?? 4030);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/posthog.js") {
    res.writeHead(200, { "content-type": "application/javascript" });
    return res.end(bundle);
  }
  const token = JSON.stringify(url.searchParams.get("token") ?? "");
  const api = JSON.stringify(url.searchParams.get("api") ?? "");
  const run = JSON.stringify(url.searchParams.get("run") ?? "");
  const event = JSON.stringify(url.searchParams.get("event") ?? "hostpog_migration_test");
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html><head><title>HostPog migration test site</title><script src="/posthog.js"></script></head>
<body><h1>HostPog migration test site</h1><p id="status">loading</p>
<script>
  posthog.init(${token}, {
    api_host: ${api},
    ui_host: "https://us.posthog.com",
    person_profiles: "identified_only",
    autocapture: false,
    opt_out_useragent_filter: true, // headless Chrome is otherwise treated as a bot
    capture_pageview: true,
    disable_session_recording: true,
    request_batching: false,
    loaded: () => {
      posthog.capture(${event}, { hostpog_run: ${run}, source: "hostpog-migration-test" });
      document.getElementById("status").textContent = "sent";
    },
  });
</script></body></html>`);
}).listen(PORT, "127.0.0.1", () => console.log(`test site on ${PORT}`));
