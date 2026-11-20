/**
 * SYNTHETIC OpenAI-compatible model for the BYOK contract test.
 * Turn 1: calls query_trend. Turn 2: submits a report citing the evidence id it
 * received in the tool result (and one fabricated id, which HostPog must strip).
 * Run: tsx e2e/fixtures/fake-llm.ts  (port 4020)
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_LLM_PORT ?? 4020);
let requests = 0;

const server = createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.url === "/__requests") return send(200, { requests });
  if (req.url?.endsWith("/models")) return send(200, { object: "list", data: [{ id: "fake-analyst-1", object: "model" }] });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests++;
    const j = JSON.parse(body || "{}") as { messages?: { role: string; content: unknown }[]; tools?: unknown[] };
    const msgs = j.messages ?? [];
    const toolMsgs = msgs.filter((m) => m.role === "tool");
    const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
    const call = (name: string, args: unknown) =>
      send(200, {
        id: `cmpl-${requests}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "fake-analyst-1",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `call_${requests}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
        usage,
      });
    if (!j.tools?.length) {
      return send(200, { id: "t", object: "chat.completion", created: 0, model: "fake-analyst-1", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }], usage });
    }
    const toolNames = (j.tools as { function?: { name?: string } }[]).map((t) => t.function?.name);
    if (toolNames.includes("create_feature_flag")) {
      // product assistant: create a flag when asked, otherwise answer from one trend query
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      const asked = JSON.stringify(lastUser?.content ?? "").toLowerCase();
      const text = (content: string) =>
        send(200, { id: `cmpl-${requests}`, object: "chat.completion", created: 0, model: "fake-analyst-1", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage });
      const lastIsTool = msgs[msgs.length - 1]?.role === "tool";
      if (asked.includes("flag")) {
        if (!lastIsTool) return call("create_feature_flag", { key: "new-onboarding", name: "New onboarding", rolloutPercent: 20, conditions: [], variants: [] });
        return text("Created the **new-onboarding** flag at 20% rollout. It's off until you turn it on.");
      }
      const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
      const toolsSinceUser = msgs.slice(lastUserIdx).filter((m) => m.role === "tool");
      // an intermediate lookup (all events), then the real one, then pick only the real one to show
      if (toolsSinceUser.length === 0) return call("query_trend", { event: null, math: "total", interval: "day", dateFrom: "-14d", dateTo: "now", compare: false, filters: [] });
      if (toolsSinceUser.length === 1) return call("query_trend", { event: "signed_up", math: "total", interval: "day", dateFrom: "-14d", dateTo: "now", compare: false, filters: [] });
      if (toolsSinceUser.length === 2) {
        const ev = /ev_\d\d/.exec(JSON.stringify(toolsSinceUser[1]!.content))?.[0] ?? "ev_02";
        return call("show_chart", { evidenceId: ev, title: "Signups per day" });
      }
      return text("Signups over the last 14 days are shown below.");
    }
    if (toolMsgs.length === 0) {
      return call("query_trend", { event: "signed_up", math: "total", interval: "day", dateFrom: "-14d", dateTo: "now", compare: true, filters: [] });
    }
    const last = JSON.stringify(toolMsgs[toolMsgs.length - 1]!.content);
    const ev = /ev_\d\d/.exec(last)?.[0] ?? "ev_01";
    return call("submit_report", {
      title: "Signups are flat week over week",
      kind: "no_finding",
      summary: "signed_up volume shows no significant change against the previous period.",
      baseline: "previous 14 days",
      current: "last 14 days",
      impactEstimate: null,
      assumptions: ["tracking unchanged"],
      confidence: "medium",
      confidenceReason: "single aggregate series",
      observations: [
        { statement: "signed_up trend compared with previous period", evidenceIds: [ev] },
        { statement: "fabricated claim without evidence", evidenceIds: ["ev_77"] },
      ],
      hypotheses: [{ statement: "no change in the funnel", status: "correlated", evidenceIds: [ev] }],
      affectedSegments: [],
      reproductionSteps: [],
      recommendation: "No action needed.",
      validationMetric: "signed_up per day",
      nextAction: "Re-check next week",
      limitations: [],
    });
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake llm on ${PORT}`));
