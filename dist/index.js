import { HindsightClient } from '@vectorize-io/hindsight-client';
import { basename, dirname } from 'path';
import { execFileSync } from 'child_process';
import { tool } from '@kilocode/plugin/tool';

// src/index.ts

// src/config.ts
var DEFAULTS = {
  // Recall
  autoRecall: true,
  recallBudget: "mid",
  recallMaxTokens: 1024,
  recallTypes: ["world", "experience"],
  recallContextTurns: 1,
  recallMaxQueryChars: 800,
  recallTags: [],
  recallTagsMatch: "any",
  recallPromptPreamble: "Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:",
  // Retain
  autoRetain: true,
  retainMode: "full-session",
  retainEveryNTurns: 3,
  retainOverlapTurns: 2,
  retainContext: "kilo",
  retainTags: [],
  retainMetadata: {},
  // Connection
  hindsightApiUrl: null,
  hindsightApiToken: null,
  // Bank
  bankId: null,
  bankIdPrefix: "",
  dynamicBankId: false,
  dynamicBankGranularity: ["agent", "project"],
  bankMission: "",
  retainMission: null,
  agentName: "kilo",
  // Misc
  debug: false
};
var ENV_OVERRIDES = {
  HINDSIGHT_API_URL: ["hindsightApiUrl", "string"],
  HINDSIGHT_API_TOKEN: ["hindsightApiToken", "string"],
  HINDSIGHT_BANK_ID: ["bankId", "string"],
  HINDSIGHT_AGENT_NAME: ["agentName", "string"],
  HINDSIGHT_AUTO_RECALL: ["autoRecall", "bool"],
  HINDSIGHT_AUTO_RETAIN: ["autoRetain", "bool"],
  HINDSIGHT_RETAIN_MODE: ["retainMode", "string"],
  HINDSIGHT_RECALL_BUDGET: ["recallBudget", "string"],
  HINDSIGHT_RECALL_MAX_TOKENS: ["recallMaxTokens", "int"],
  HINDSIGHT_RECALL_MAX_QUERY_CHARS: ["recallMaxQueryChars", "int"],
  HINDSIGHT_RECALL_CONTEXT_TURNS: ["recallContextTurns", "int"],
  HINDSIGHT_DYNAMIC_BANK_ID: ["dynamicBankId", "bool"],
  HINDSIGHT_BANK_MISSION: ["bankMission", "string"],
  HINDSIGHT_DEBUG: ["debug", "bool"]
};
function castEnv(value, typ) {
  if (typ === "bool") return ["true", "1", "yes"].includes(value.toLowerCase());
  if (typ === "int") {
    const n = parseInt(value, 10);
    return isNaN(n) ? null : n;
  }
  return value;
}
function loadConfig(pluginOptions) {
  const config = { ...DEFAULTS };
  if (pluginOptions) {
    for (const [key, value] of Object.entries(pluginOptions)) {
      if (value !== null && value !== void 0) {
        config[key] = value;
      }
    }
  }
  for (const [envName, [key, typ]] of Object.entries(ENV_OVERRIDES)) {
    const val = process.env[envName];
    if (val !== void 0) {
      const castVal = castEnv(val, typ);
      if (castVal !== null) {
        config[key] = castVal;
      }
    }
  }
  const recallTagsEnv = process.env["HINDSIGHT_RECALL_TAGS"];
  if (recallTagsEnv !== void 0) {
    config["recallTags"] = recallTagsEnv.split(",").map((t) => t.trim()).filter(Boolean);
  }
  const recallTagsMatchEnv = process.env["HINDSIGHT_RECALL_TAGS_MATCH"];
  if (recallTagsMatchEnv !== void 0) {
    config["recallTagsMatch"] = recallTagsMatchEnv;
  }
  const result = config;
  const VALID_RETAIN_MODES = ["full-session", "last-turn"];
  if (!VALID_RETAIN_MODES.includes(result.retainMode)) {
    console.error(
      `[Hindsight] Unknown retainMode "${result.retainMode}" \u2014 valid: ${VALID_RETAIN_MODES.join(", ")}. Falling back to "full-session".`
    );
    result.retainMode = "full-session";
  }
  const VALID_TAGS_MATCH = ["any", "all", "any_strict", "all_strict"];
  if (!VALID_TAGS_MATCH.includes(result.recallTagsMatch)) {
    console.error(
      `[Hindsight] Unknown recallTagsMatch "${result.recallTagsMatch}" \u2014 valid: ${VALID_TAGS_MATCH.join(", ")}. Falling back to "any".`
    );
    result.recallTagsMatch = "any";
  }
  const VALID_BUDGETS = ["low", "mid", "high"];
  if (!VALID_BUDGETS.includes(result.recallBudget)) {
    console.error(
      `[Hindsight] Unknown recallBudget "${result.recallBudget}" \u2014 valid: ${VALID_BUDGETS.join(", ")}. Falling back to "mid".`
    );
    result.recallBudget = "mid";
  }
  return result;
}
function debugLog(config, ...args) {
  if (config.debug) {
    console.error("[Hindsight]", ...args);
  }
}
var DEFAULT_BANK_NAME = "kilo";
var VALID_FIELDS = /* @__PURE__ */ new Set(["agent", "project", "gitProject", "channel", "user"]);
function getProjectRootFromGit(directory) {
  if (!directory) return null;
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: directory,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1e3
      }
    ).trim();
    if (!commonDir) return null;
    if (basename(commonDir) === ".git") {
      return dirname(commonDir);
    }
    return commonDir;
  } catch {
    return null;
  }
}
function deriveGitProjectName(directory) {
  const projectRoot = getProjectRootFromGit(directory);
  if (projectRoot) return basename(projectRoot);
  return directory ? basename(directory) : "unknown";
}
function deriveBankId(config, directory) {
  const prefix = config.bankIdPrefix;
  if (!config.dynamicBankId) {
    const base = config.bankId || DEFAULT_BANK_NAME;
    return prefix ? `${prefix}-${base}` : base;
  }
  const fields = config.dynamicBankGranularity?.length ? config.dynamicBankGranularity : ["agent", "project"];
  for (const f of fields) {
    if (!VALID_FIELDS.has(f)) {
      console.error(
        `[Hindsight] Unknown dynamicBankGranularity field "${f}" \u2014 valid: ${[...VALID_FIELDS].sort().join(", ")}`
      );
    }
  }
  const channelId = process.env.HINDSIGHT_CHANNEL_ID || "";
  const userId = process.env.HINDSIGHT_USER_ID || "";
  const fieldResolvers = {
    agent: () => config.agentName || "kilo",
    project: () => directory ? basename(directory) : "unknown",
    gitProject: () => deriveGitProjectName(directory),
    channel: () => channelId || "default",
    user: () => userId || "anonymous"
  };
  const segments = fields.map((f) => fieldResolvers[f]?.() || "unknown");
  const baseBankId = segments.join("::");
  return prefix ? `${prefix}-${baseBankId}` : baseBankId;
}
async function ensureBankMission(client, bankId, config, missionsSet) {
  const mission = config.bankMission;
  if (!mission?.trim()) return;
  if (missionsSet.has(bankId)) return;
  try {
    await client.createBank(bankId, {
      reflectMission: mission,
      retainMission: config.retainMission || void 0
    });
    missionsSet.add(bankId);
    if (missionsSet.size > 1e4) {
      const keys = [...missionsSet].sort();
      for (const k of keys.slice(0, keys.length >> 1)) {
        missionsSet.delete(k);
      }
    }
    debugLog(config, `Set mission for bank: ${bankId}`);
  } catch (e) {
    debugLog(config, `Could not set bank mission for ${bankId}: ${e}`);
  }
}

// src/content.ts
function stripMemoryTags(content) {
  content = content.replace(/<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g, "");
  content = content.replace(/<relevant_memories>[\s\S]*?<\/relevant_memories>/g, "");
  return content;
}
function formatMemories(results) {
  if (!results.length) return "";
  return results.map((r) => {
    const typeStr = r.type ? ` [${r.type}]` : "";
    const dateStr = r.mentioned_at ? ` (${r.mentioned_at})` : "";
    return `- ${r.text}${typeStr}${dateStr}`;
  }).join("\n\n");
}
function formatCurrentTime() {
  const now = /* @__PURE__ */ new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}
function composeRecallQuery(latestQuery, messages, recallContextTurns) {
  const latest = latestQuery.trim();
  if (recallContextTurns <= 1 || !messages.length) return latest;
  const contextual = sliceLastTurnsByUserBoundary(messages, recallContextTurns);
  const contextLines = [];
  for (const msg of contextual) {
    const content = stripMemoryTags(msg.content).trim();
    if (!content) continue;
    if (msg.role === "user" && content === latest) continue;
    contextLines.push(`${msg.role}: ${content}`);
  }
  if (!contextLines.length) return latest;
  return ["Prior context:", contextLines.join("\n"), latest].join("\n\n");
}
function truncateRecallQuery(query, latestQuery, maxChars) {
  if (maxChars <= 0 || query.length <= maxChars) return query;
  const latest = latestQuery.trim();
  const latestOnly = latest.length > maxChars ? latest.slice(0, maxChars) : latest;
  if (!query.includes("Prior context:")) return latestOnly;
  const contextMarker = "Prior context:\n\n";
  const markerIndex = query.indexOf(contextMarker);
  if (markerIndex === -1) return latestOnly;
  const suffix = "\n\n" + latest;
  const suffixIndex = query.lastIndexOf(suffix);
  if (suffixIndex === -1) return latestOnly;
  if (suffix.length >= maxChars) return latestOnly;
  const contextBody = query.slice(markerIndex + contextMarker.length, suffixIndex);
  const contextLines = contextBody.split("\n").filter(Boolean);
  const kept = [];
  for (let i = contextLines.length - 1; i >= 0; i--) {
    kept.unshift(contextLines[i]);
    const candidate = `${contextMarker}${kept.join("\n")}${suffix}`;
    if (candidate.length > maxChars) {
      kept.shift();
      break;
    }
  }
  if (kept.length) return `${contextMarker}${kept.join("\n")}${suffix}`;
  return latestOnly;
}
function sliceLastTurnsByUserBoundary(messages, turns) {
  if (!messages.length || turns <= 0) return [];
  let userTurnsSeen = 0;
  let startIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userTurnsSeen++;
      if (userTurnsSeen >= turns) {
        startIndex = i;
        break;
      }
    }
  }
  return startIndex === -1 ? [...messages] : messages.slice(startIndex);
}
function prepareRetentionTranscript(messages, retainFullWindow = false) {
  if (!messages.length) return { transcript: null, messageCount: 0 };
  let targetMessages;
  if (retainFullWindow) {
    targetMessages = messages;
  } else {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return { transcript: null, messageCount: 0 };
    targetMessages = messages.slice(lastUserIdx);
  }
  const parts = [];
  for (const msg of targetMessages) {
    const content = stripMemoryTags(msg.content).trim();
    if (!content) continue;
    parts.push(`[role: ${msg.role}]
${content}
[${msg.role}:end]`);
  }
  if (!parts.length) return { transcript: null, messageCount: 0 };
  const transcript = parts.join("\n\n");
  if (transcript.trim().length < 10) return { transcript: null, messageCount: 0 };
  return { transcript, messageCount: parts.length };
}

// src/tools.ts
function createTools(client, bankId, config, missionsSet) {
  const hindsight_retain = tool({
    description: "Store information in long-term memory. Use this to remember important facts, user preferences, project context, decisions, and anything worth recalling in future sessions. Be specific \u2014 include who, what, when, and why.",
    args: {
      content: tool.schema.string().describe("The information to remember. Be specific and self-contained."),
      context: tool.schema.string().optional().describe("Optional context about where this information came from.")
    },
    async execute(args, _context) {
      if (missionsSet) {
        await ensureBankMission(client, bankId, config, missionsSet);
      }
      await client.retain(bankId, args.content, {
        context: args.context || config.retainContext,
        tags: config.retainTags.length ? config.retainTags : void 0,
        metadata: Object.keys(config.retainMetadata).length ? config.retainMetadata : void 0
      });
      return "Memory stored successfully.";
    }
  });
  const hindsight_recall = tool({
    description: "Search long-term memory for relevant information. Use this proactively before answering questions about past conversations, user preferences, project history, or any topic where prior context would help. When in doubt, recall first.",
    args: {
      query: tool.schema.string().describe("Natural language search query. Be specific about what you need to know.")
    },
    async execute(args, _context) {
      const response = await client.recall(bankId, args.query, {
        budget: config.recallBudget,
        maxTokens: config.recallMaxTokens,
        types: config.recallTypes,
        tags: config.recallTags.length ? config.recallTags : void 0,
        tagsMatch: config.recallTags.length ? config.recallTagsMatch : void 0
      });
      const results = response.results || [];
      if (!results.length) return "No relevant memories found.";
      const formatted = formatMemories(results);
      return `Found ${results.length} relevant memories (as of ${formatCurrentTime()} UTC):

${formatted}`;
    }
  });
  const hindsight_reflect = tool({
    description: 'Generate a thoughtful answer using long-term memory. Unlike recall (which returns raw memories), reflect synthesizes memories into a coherent answer. Use for questions like "What do you know about this user?" or "Summarize our project decisions."',
    args: {
      query: tool.schema.string().describe("The question to answer using long-term memory."),
      context: tool.schema.string().optional().describe("Optional additional context to guide the reflection.")
    },
    async execute(args, _context) {
      if (missionsSet) {
        await ensureBankMission(client, bankId, config, missionsSet);
      }
      const response = await client.reflect(bankId, args.query, {
        context: args.context,
        budget: config.recallBudget
      });
      return response.text || "No relevant information found to reflect on.";
    }
  });
  return { hindsight_retain, hindsight_recall, hindsight_reflect };
}

// src/hooks.ts
function createHooks(hindsightClient, bankId, config, state2, kiloClient) {
  async function recallForContext(query) {
    try {
      const response = await hindsightClient.recall(bankId, query, {
        budget: config.recallBudget,
        maxTokens: config.recallMaxTokens,
        types: config.recallTypes,
        tags: config.recallTags.length ? config.recallTags : void 0,
        tagsMatch: config.recallTags.length ? config.recallTagsMatch : void 0
      });
      const results = response.results || [];
      if (!results.length) return { context: null, ok: true };
      const formatted = formatMemories(results);
      const context = `<hindsight_memories>
${config.recallPromptPreamble}
Current time: ${formatCurrentTime()} UTC

${formatted}
</hindsight_memories>`;
      return { context, ok: true };
    } catch (e) {
      debugLog(config, "Recall failed:", e);
      return { context: null, ok: false };
    }
  }
  async function getSessionMessages(sessionId) {
    try {
      debugLog(config, `getSessionMessages: fetching messages for session ${sessionId}`);
      const response = await kiloClient.session.messages({
        path: { id: sessionId }
      });
      if (response.error) {
        debugLog(
          config,
          `getSessionMessages: error=${JSON.stringify(response.error)?.substring(0, 500)}`
        );
      }
      const rawMessages = response.data || [];
      const messages = [];
      for (const msg of rawMessages) {
        const role = msg.info.role;
        if (role !== "user" && role !== "assistant") continue;
        const textParts = msg.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text);
        if (textParts.length) {
          messages.push({ role, content: textParts.join("\n") });
        }
      }
      debugLog(config, `getSessionMessages: raw=${rawMessages.length}, parsed=${messages.length}`);
      return messages;
    } catch (e) {
      debugLog(config, "Failed to get session messages:", e);
      return [];
    }
  }
  async function retainSession(sessionId, messages) {
    const retainFullWindow = config.retainMode === "full-session";
    let targetMessages;
    let documentId;
    if (retainFullWindow) {
      targetMessages = messages;
      documentId = sessionId;
    } else {
      const windowTurns = config.retainEveryNTurns + config.retainOverlapTurns;
      targetMessages = sliceLastTurnsByUserBoundary(messages, windowTurns);
      documentId = `${sessionId}-${Date.now()}`;
    }
    const { transcript } = prepareRetentionTranscript(targetMessages, true);
    if (!transcript) return;
    await ensureBankMission(hindsightClient, bankId, config, state2.missionsSet);
    await hindsightClient.retain(bankId, transcript, {
      documentId,
      context: config.retainContext,
      tags: config.retainTags.length ? config.retainTags : void 0,
      metadata: Object.keys(config.retainMetadata).length ? { ...config.retainMetadata, session_id: sessionId } : { session_id: sessionId },
      async: true
    });
  }
  async function handleSessionIdle(sessionId) {
    debugLog(config, `handleSessionIdle called for session ${sessionId}`);
    if (!config.autoRetain) return;
    const messages = await getSessionMessages(sessionId);
    if (!messages.length) return;
    const userTurns = messages.filter((m) => m.role === "user").length;
    const lastRetained = state2.lastRetainedTurn.get(sessionId) || 0;
    debugLog(
      config,
      `handleSessionIdle: userTurns=${userTurns}, lastRetained=${lastRetained}, retainEveryNTurns=${config.retainEveryNTurns}`
    );
    if (userTurns - lastRetained < config.retainEveryNTurns) return;
    try {
      await retainSession(sessionId, messages);
      state2.lastRetainedTurn.set(sessionId, userTurns);
      debugLog(config, `Auto-retained ${messages.length} messages for session ${sessionId}`);
    } catch (e) {
      debugLog(config, "Auto-retain failed:", e);
    }
  }
  const event = async (input) => {
    try {
      const { event: evt } = input;
      debugLog(config, `event hook fired: type=${evt.type}`);
      if (evt.type === "session.idle") {
        const sessionId = evt.properties.sessionID;
        if (sessionId) {
          await handleSessionIdle(sessionId);
        }
      }
      if (evt.type === "session.created") {
        const info = evt.properties.info;
        const sessionId = info?.id;
        if (sessionId && config.autoRecall && !state2.recalledSessions.has(sessionId)) {
          state2.recalledSessions.add(sessionId);
          if (state2.recalledSessions.size > 1e3) {
            const first = state2.recalledSessions.values().next().value;
            if (first) state2.recalledSessions.delete(first);
          }
        }
      }
    } catch (e) {
      debugLog(config, "Event hook error:", e);
    }
  };
  const compacting = async (input, output) => {
    try {
      const messages = await getSessionMessages(input.sessionID);
      if (messages.length && config.autoRetain) {
        try {
          await retainSession(input.sessionID, messages);
          state2.lastRetainedTurn.delete(input.sessionID);
          debugLog(config, "Pre-compaction retain completed");
        } catch (e) {
          debugLog(config, "Pre-compaction retain failed:", e);
        }
      }
      if (messages.length) {
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const query = composeRecallQuery(
            lastUserMsg.content,
            messages,
            config.recallContextTurns
          );
          const truncated = truncateRecallQuery(
            query,
            lastUserMsg.content,
            config.recallMaxQueryChars
          );
          const { context } = await recallForContext(truncated);
          if (context) {
            output.context.push(context);
          }
        }
      }
    } catch (e) {
      debugLog(config, "Compaction hook error:", e);
    }
  };
  const systemTransform = async (input, output) => {
    try {
      if (!config.autoRecall) return;
      const sessionId = input.sessionID;
      if (!sessionId) return;
      if (!state2.recalledSessions.has(sessionId)) return;
      await ensureBankMission(hindsightClient, bankId, config, state2.missionsSet);
      const query = `project context and recent work`;
      const { context, ok } = await recallForContext(query);
      if (ok) {
        state2.recalledSessions.delete(sessionId);
      }
      if (context) {
        output.system.push(context);
        debugLog(config, `Injected recall context for session ${sessionId}`);
      }
    } catch (e) {
      debugLog(config, "System transform hook error:", e);
    }
  };
  return {
    event,
    "experimental.session.compacting": compacting,
    "experimental.chat.system.transform": systemTransform
  };
}

// src/index.ts
var state = {
  turnCount: 0,
  missionsSet: /* @__PURE__ */ new Set(),
  recalledSessions: /* @__PURE__ */ new Set(),
  lastRetainedTurn: /* @__PURE__ */ new Map()
};
var HindsightPlugin = async (input, options) => {
  const config = loadConfig(options);
  const apiUrl = config.hindsightApiUrl;
  if (!apiUrl) {
    console.error(
      "[Hindsight] No API URL configured. Set HINDSIGHT_API_URL environment variable."
    );
    return {};
  }
  const client = new HindsightClient({
    baseUrl: apiUrl,
    apiKey: config.hindsightApiToken || void 0
  });
  const bankId = deriveBankId(config, input.directory || process.cwd());
  debugLog(config, `Initialized with bank: ${bankId}, API: ${apiUrl}`);
  const tools = createTools(client, bankId, config, state.missionsSet);
  const hooks = createHooks(
    client,
    bankId,
    config,
    state,
    input.client
  );
  return {
    tool: tools,
    ...hooks
  };
};
var index_default = HindsightPlugin;

export { HindsightPlugin, index_default as default, deriveBankId, loadConfig };
