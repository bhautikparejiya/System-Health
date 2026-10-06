import { V } from "../ghl";
import type { Issue, ModuleResult } from "../types";
import { CheckContext, DAY, links, mapLimit, plural, result } from "./common";

interface ConversationAgent {
  id: string;
  name: string;
  mode?: "off" | "suggestive" | "auto-pilot";
  channels?: string[];
  actions?: unknown[];
}

export async function checkConversationAi(ctx: CheckContext): Promise<ModuleResult> {
  const loc = ctx.locationId;
  const res = await ctx.api<{ agents?: ConversationAgent[] }>("/conversation-ai/agents/search", {
    version: V.conversationAi,
    query: { limit: 50 },
  });
  const agents = res.agents ?? [];
  if (!agents.length) return result("conversationAi", "0", [{ label: "No agents", tone: "info" }], [], { status: "na" });

  const on = agents.filter((a) => a.mode && a.mode !== "off");
  const off = agents.filter((a) => !a.mode || a.mode === "off");
  const issues: Issue[] = [];
  if (ctx.settings.flagOffConversationAgents) {
    for (const a of off) {
      issues.push({
        key: `cai-off:${a.id}`,
        module: "conversationAi",
        severity: "warning",
        title: `Conversation AI “${a.name}” is turned off`,
        detail: "It will not reply to anyone. Switch it to Auto-pilot or Suggestive, or disable this check in Settings.",
        link: links.conversationAi(loc),
      });
    }
  }
  for (const a of on) {
    if (!a.channels?.length) {
      issues.push({
        key: `cai-nochannel:${a.id}`,
        module: "conversationAi",
        severity: "warning",
        title: `Conversation AI “${a.name}” is on but has no channels`,
        detail: "Assign at least one channel (SMS, Web chat, Facebook…) so it can answer messages.",
        link: links.conversationAi(loc),
      });
    }
  }
  const autopilot = agents.filter((a) => a.mode === "auto-pilot").length;
  return result(
    "conversationAi",
    String(agents.length),
    [
      { label: `${on.length} active`, tone: "ok" },
      ...(autopilot ? [{ label: `${autopilot} auto-pilot`, tone: "info" as const }] : []),
      ...(off.length ? [{ label: `${off.length} off`, tone: "warn" as const }] : []),
    ],
    issues,
  );
}

interface VoiceAgent {
  id: string;
  agentName: string;
  inboundNumber?: string;
  numberPoolId?: string;
}

export async function checkVoiceAi(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  const res = await ctx.api<{ agents?: VoiceAgent[] }>("/voice-ai/agents", {
    version: V.voiceAi,
    query: { locationId: loc, page: 1, pageSize: 50 },
  });
  const agents = res.agents ?? [];
  if (!agents.length) return result("voiceAi", "0", [{ label: "No agents", tone: "info" }], [], { status: "na" });

  const issues: Issue[] = [];
  const startDate = now.getTime() - settings.voiceIdleDays * DAY;
  let totalCalls = 0;
  let idle = 0;
  await mapLimit(agents, 3, async (a) => {
    if (!a.inboundNumber && !a.numberPoolId) {
      issues.push({
        key: `vai-nonumber:${a.id}`,
        module: "voiceAi",
        severity: "info",
        title: `Voice AI “${a.agentName}” has no phone number`,
        detail: "It can't receive calls until a number is assigned.",
        link: links.voiceAi(loc),
      });
      return;
    }
    const logs = await ctx.api<{ total?: number }>("/voice-ai/dashboard/call-logs", {
      version: V.voiceAi,
      query: { locationId: loc, agentId: a.id, callType: "LIVE", startDate, endDate: now.getTime(), page: 1, pageSize: 10 },
    });
    const calls = logs.total ?? 0;
    totalCalls += calls;
    if (calls === 0) {
      idle++;
      issues.push({
        key: `vai-idle:${a.id}`,
        module: "voiceAi",
        severity: "critical",
        title: `Voice AI “${a.agentName}” handled 0 calls in ${plural(settings.voiceIdleDays, "day")}`,
        detail: `Number ${a.inboundNumber ?? "(pool)"} · Check call forwarding, the phone number and agent working hours`,
        link: links.voiceAi(loc),
      });
    }
  });
  return result(
    "voiceAi",
    String(agents.length),
    [
      { label: `${totalCalls} calls / ${settings.voiceIdleDays}d`, tone: "info" },
      ...(idle ? [{ label: `${idle} silent`, tone: "bad" as const }] : [{ label: "all answering", tone: "ok" as const }]),
    ],
    issues,
  );
}
