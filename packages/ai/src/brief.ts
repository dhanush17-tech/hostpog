import type { InvestigationReport } from "@hostpog/contracts";
import type { EvidenceRecord } from "./tools";

function evidenceLines(report: InvestigationReport, evidence: EvidenceRecord[], selected?: string[]) {
  const cited = new Set(selected ?? report.observations.flatMap((o) => o.evidenceIds));
  return evidence
    .filter((e) => cited.has(e.id))
    .map((e) => {
      const r = e.meta.range ? `${e.meta.range.from.slice(0, 10)} → ${e.meta.range.to.slice(0, 10)}` : "n/a";
      return `- ${e.id}: ${e.tool}(${JSON.stringify(e.input)}) · source ${e.meta.source?.label ?? "?"} · range ${r} (${e.meta.timezone ?? "UTC"}) · fingerprint ${e.meta.fingerprint ?? "n/a"}`;
    });
}

export function engineeringTicket(report: InvestigationReport, evidence: EvidenceRecord[], selected?: string[]): string {
  return [
    `# ${report.title}`,
    "",
    `**Type:** ${report.kind} · **Confidence:** ${report.confidence} — ${report.confidenceReason}`,
    "",
    "## Summary",
    report.summary,
    "",
    "## Baseline vs current",
    `- Baseline: ${report.baseline ?? "n/a"}`,
    `- Current: ${report.current ?? "n/a"}`,
    `- Impact estimate: ${report.impactEstimate ?? "n/a"}${report.assumptions.length ? ` (assumes: ${report.assumptions.join("; ")})` : ""}`,
    "",
    "## Observed facts",
    ...report.observations.map((o) => `- ${o.statement} [${o.evidenceIds.join(", ")}]`),
    "",
    "## Hypotheses",
    ...report.hypotheses.map((h) => `- (${h.status}) ${h.statement}${h.evidenceIds.length ? ` [${h.evidenceIds.join(", ")}]` : ""}`),
    "",
    "## Affected segments",
    ...(report.affectedSegments.length ? report.affectedSegments.map((s) => `- ${s}`) : ["- none identified"]),
    "",
    "## Reproduction",
    ...(report.reproductionSteps.length ? report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`) : ["Not established from analytics data."]),
    "",
    "## Recommendation",
    report.recommendation,
    "",
    `**Validate with:** ${report.validationMetric}`,
    `**Next action:** ${report.nextAction}`,
    "",
    "## Limitations",
    ...report.limitations.map((l) => `- ${l}`),
    "",
    "## Evidence (reproducible queries in HostPog)",
    ...evidenceLines(report, evidence, selected),
  ].join("\n");
}

export function codingAgentPrompt(report: InvestigationReport, evidence: EvidenceRecord[], selected?: string[]): string {
  return [
    "You are working in the product's code repository. Product analytics (HostPog) surfaced the following.",
    "Treat it as evidence, not as a verified root cause. Confirm in the code before changing anything.",
    "",
    `Issue: ${report.title}`,
    `Summary: ${report.summary}`,
    `Affected segments: ${report.affectedSegments.join("; ") || "unknown"}`,
    "Observed facts:",
    ...report.observations.map((o) => `- ${o.statement}`),
    "Hypotheses (unverified unless marked supported):",
    ...report.hypotheses.map((h) => `- [${h.status}] ${h.statement}`),
    report.reproductionSteps.length ? `Reproduction:\n${report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    "",
    "Task:",
    "1. Locate the code paths involved in the affected flow and segment.",
    "2. Explain whether the hypotheses are consistent with the code; propose a minimal fix only if you can verify it.",
    `3. Add or describe a test, and how to confirm the fix with: ${report.validationMetric}`,
    "Do not push, deploy or open PRs without explicit approval.",
    "",
    "Evidence references:",
    ...evidenceLines(report, evidence, selected),
  ]
    .filter((l) => l !== "")
    .join("\n");
}
