import { Bot } from "lucide-react";
import { CopyBlock, CopyButton } from "@/components/docs/copy-button";
import { KeyLinks } from "@/components/docs/key-links";
import { DocPage } from "@/components/prose";

export const metadata = { title: "Self-hosting" };

const REPO = process.env.NEXT_PUBLIC_HOSTPOG_REPO_URL ?? "<hostpog repository URL>";

const QUICKSTART = `git clone ${REPO} hostpog && cd hostpog
./hostpog up`;

const DEV_SETUP = `cp .env.example .env
echo "HOSTPOG_MASTER_KEY=$(openssl rand -base64 32)" >> .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
pnpm install
pnpm infra:up       # postgres, clickhouse, redis (dev credentials only)
pnpm db:migrate
pnpm dev            # web on :3000, ingest on :3001`;

const AGENT_PROMPT = `Set up hostpog (open-source product analytics) on this machine.

Repository: ${REPO}

Do this step by step and tell me what you did after each step:
1. Check that Docker is installed and running (docker info) and that Docker Compose v2 works (docker compose version). If not, tell me how to install or start Docker for my OS and wait — don't install system software yourself.
2. Clone the repository (skip if I'm already inside it) and cd into it.
3. Run ./hostpog up. The first run generates secrets into deploy/.env and builds the images (a few minutes). Never print the secrets back to me and never commit deploy/.env.
4. If port 3000 or 3001 is taken, change WEB_PORT/INGEST_PORT and the matching HOSTPOG_PUBLIC_URL / HOSTPOG_INGEST_PUBLIC_URL in deploy/.env, then run ./hostpog up again. For any other failure, show me ./hostpog logs and your proposed fix before changing code.
5. Finish by telling me: the URL to open, that I should create an account there, and that I'll connect PostHog or add an AI key from inside the app (I'll paste keys there myself — don't ask me for them here). Remind me to back up deploy/.env.`;

export default function SelfHost() {
  return (
    <DocPage title="Self-hosting" lead="One command on any machine with Docker. Postgres, ClickHouse, the app and the ingest server, with secrets generated for you.">
      <div className="not-prose mt-6 rounded-2xl border border-[#ffd9bd] bg-gradient-to-br from-white to-[#fff4ec] p-5 shadow-card">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Bot size={17} className="text-[#e2620f]" aria-hidden /> Let your coding agent do it
        </p>
        <p className="mt-1 text-[14px] leading-6 text-ink-3">Paste this prompt into Claude Code, Codex or Cursor in an empty folder. It checks Docker, runs the installer and tells you where to log in. It asks before installing anything.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <CopyButton text={AGENT_PROMPT} label="Copy agent prompt" className="border-transparent bg-primary !text-white hover:bg-primary/90" />
          <details className="text-[13px] text-ink-3">
            <summary className="cursor-pointer select-none px-2 py-1 hover:text-ink">Preview prompt</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel p-3 text-[12px] leading-5 text-ink-2">{AGENT_PROMPT}</pre>
          </details>
        </div>
      </div>

      <h2>Get your keys</h2>
      <p>You only need the ones you&apos;ll use. Each button opens the exact page where the key is created; you paste it into hostpog afterwards.</p>
      <h3>PostHog (to connect existing data)</h3>
      <KeyLinks
        items={[
          { logoId: "posthog", name: "PostHog US Cloud", what: "Create a personal API key with read access (query:read is the one that matters).", href: "https://us.posthog.com/settings/user-api-keys", cta: "Open US key page" },
          { logoId: "posthog", name: "PostHog EU Cloud", what: "Same as above, for projects hosted in the EU.", href: "https://eu.posthog.com/settings/user-api-keys", cta: "Open EU key page" },
        ]}
      />
      <p className="!mt-2 text-[13px]">Not sure which? Look at the address bar when you&apos;re logged into PostHog — it starts with <code>us.</code> or <code>eu.</code>. Self-hosted PostHog: open <code>/settings/user-api-keys</code> on your own domain.</p>
      <h3>AI model (for investigations — optional)</h3>
      <KeyLinks
        items={[
          { logoId: "gemini", name: "Google Gemini", what: "Fastest way to start: AI Studio has a free tier and no billing setup.", href: "https://aistudio.google.com/apikey", cta: "Get a Gemini key" },
          { logoId: "openrouter", name: "OpenRouter", what: "One key for hundreds of models from every major lab.", href: "https://openrouter.ai/settings/keys", cta: "Get an OpenRouter key" },
          { logoId: "claude", name: "Anthropic (Claude)", what: "Create a key in the Claude Console. Requires billing on the account.", href: "https://platform.claude.com/settings/keys", cta: "Get a Claude key" },
          { logoId: "openai", name: "OpenAI", what: "Create a project API key. Requires billing on the account.", href: "https://platform.openai.com/api-keys", cta: "Get an OpenAI key" },
          { logoId: "ollama", name: "Local model (Ollama)", what: "Keeps everything on your machine. Set HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS=localhost.", href: "https://ollama.com/download", cta: "Download Ollama" },
        ]}
      />

      <h2>Quickstart</h2>
      <CopyBlock code={QUICKSTART} />
      <p>
        Open <code>http://localhost:3000</code> and create an account. The first run builds the images (a few minutes) and writes generated secrets to{" "}
        <code>deploy/.env</code>. <strong>Back that file up</strong>: <code>HOSTPOG_MASTER_KEY</code> encrypts every stored PostHog and AI key.
      </p>
      <table>
        <tbody>
          <tr>
            <td><code>./hostpog up</code></td>
            <td>Start everything (first run: generate secrets and build).</td>
          </tr>
          <tr>
            <td><code>./hostpog status</code> / <code>logs</code></td>
            <td>Service health, or follow logs (<code>./hostpog logs web</code>).</td>
          </tr>
          <tr>
            <td><code>./hostpog update</code></td>
            <td>Rebuild from your checkout after <code>git pull</code> and restart. Migrations run automatically.</td>
          </tr>
          <tr>
            <td><code>./hostpog backup</code></td>
            <td>Postgres dump to <code>./backups</code>.</td>
          </tr>
          <tr>
            <td><code>./hostpog down</code></td>
            <td>Stop. Data stays in Docker volumes.</td>
          </tr>
        </tbody>
      </table>
      <h2>Requirements</h2>
      <ul>
        <li>Docker with Compose v2 (Docker Desktop on Mac/Windows)</li>
        <li>2 GB RAM minimum, 4 GB+ recommended (ClickHouse likes memory)</li>
        <li>On a server: put a TLS proxy (Caddy, nginx) in front of ports 3000 and 3001 and set the https URLs in <code>deploy/.env</code> before the first run</li>
      </ul>
      <p>
        One ingest instance handles roughly 2,000–5,000 events per second (see <code>docs/loadtest.md</code>).
      </p>
      <h2>Developing on hostpog</h2>
      <CopyBlock code={DEV_SETUP} />
      <h2>Configuration</h2>
      <table>
        <tbody>
          <tr>
            <td>
              <code>HOSTPOG_MASTER_KEY</code>
            </td>
            <td>32-byte base64 key encrypting stored credentials (AES-256-GCM). Required.</td>
          </tr>
          <tr>
            <td>
              <code>BETTER_AUTH_SECRET</code>
            </td>
            <td>Session signing secret. Required.</td>
          </tr>
          <tr>
            <td>
              <code>HOSTPOG_PUBLIC_URL</code>
            </td>
            <td>Browser URL. Used for CSRF origin checks, cookies (Secure when https) and OAuth.</td>
          </tr>
          <tr>
            <td>
              <code>HOSTPOG_POSTHOG_ALLOWED_HOSTS</code>
            </td>
            <td>Self-hosted PostHog origins users may connect to. Anything else is refused (SSRF protection).</td>
          </tr>
          <tr>
            <td>
              <code>HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS</code>
            </td>
            <td>Private/local model hosts (e.g. <code>localhost</code> for Ollama). Private addresses are blocked otherwise.</td>
          </tr>
          <tr>
            <td>
              <code>HOSTPOG_POSTHOG_OAUTH_ENABLED</code>
            </td>
            <td>
              Enable PostHog OAuth. Requires a public HTTPS <code>HOSTPOG_PUBLIC_URL</code> because PostHog fetches HostPog&apos;s client metadata document at <code>/oauth/posthog-client.json</code>.
            </td>
          </tr>
        </tbody>
      </table>
      <h2>Rotating the master key</h2>
      <ol>
        <li>
          Move the current key to <code>HOSTPOG_MASTER_KEY_PREVIOUS</code> (and its version to <code>_PREVIOUS_VERSION</code>).
        </li>
        <li>
          Set a new <code>HOSTPOG_MASTER_KEY</code> with a higher <code>HOSTPOG_MASTER_KEY_VERSION</code>. Old ciphertexts still decrypt; new writes use the new key.
        </li>
        <li>Rotate credentials (Integrations → Rotate key, AI providers → re-add) to re-encrypt, then remove the previous key.</li>
      </ol>
      <h2>Backups</h2>
      <pre>
        <code>{`# Postgres (accounts, sources, encrypted credentials, dashboards, investigations)
./hostpog backup
# ClickHouse (native events) — use BACKUP ... TO Disk/S3, see ClickHouse docs`}</code>
      </pre>
      <p>Back up the master key separately from the database. Without it, stored credentials cannot be decrypted.</p>
      <h2>Production notes</h2>
      <ul>
        <li>Terminate TLS in front of web and ingest; set <code>HOSTPOG_PUBLIC_URL</code> to the https URL.</li>
        <li>Investigations run inside the web process, so use a long-running server rather than a serverless host.</li>
        <li>hostpog sends no telemetry about your instance.</li>
      </ul>
    </DocPage>
  );
}
