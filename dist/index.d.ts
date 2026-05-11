import { Plugin } from '@kilocode/plugin';

/**
 * Configuration management for the Hindsight Kilo plugin.
 *
 * Loading order (later entries win):
 * 1. Built-in defaults
 * 2. Plugin options (from kilo.json plugin tuple)
 * 3. Environment variable overrides
 */
interface HindsightConfig {
    autoRecall: boolean;
    recallBudget: string;
    recallMaxTokens: number;
    recallTypes: string[];
    recallContextTurns: number;
    recallMaxQueryChars: number;
    recallPromptPreamble: string;
    recallTags: string[];
    recallTagsMatch: string;
    autoRetain: boolean;
    retainMode: string;
    retainEveryNTurns: number;
    retainOverlapTurns: number;
    retainContext: string;
    retainTags: string[];
    retainMetadata: Record<string, string>;
    hindsightApiUrl: string | null;
    hindsightApiToken: string | null;
    bankId: string | null;
    bankIdPrefix: string;
    dynamicBankId: boolean;
    dynamicBankGranularity: string[];
    bankMission: string;
    retainMission: string | null;
    agentName: string;
    debug: boolean;
}
declare function loadConfig(pluginOptions?: Record<string, unknown>): HindsightConfig;

/**
 * Hook implementations for the Hindsight Kilo plugin.
 *
 * Hooks:
 * - event (session.created) → recall memories and inject into system prompt
 * - event (session.idle) → auto-retain conversation transcript
 * - experimental.session.compacting → inject memories into compaction context
 */

interface PluginState {
    turnCount: number;
    missionsSet: Set<string>;
    /** Track sessions we've already injected recall into */
    recalledSessions: Set<string>;
    /** Track last retained turn count per session to avoid duplicates */
    lastRetainedTurn: Map<string, number>;
}

/**
 * Bank ID derivation and mission management.
 *
 * Port of Claude Code plugin's bank.py, adapted for Kilo's context model.
 *
 * Dimensions for dynamic bank IDs:
 * - agent → configured name or "kilo"
 * - project → derived from the working directory basename
 * - gitProject → derived from the main worktree's basename when inside a
 *   git repository (so all linked worktrees of the same repo
 *   share a single memory bank). Falls back to the working
 *   directory basename when git is unavailable or the
 *   directory is not a repo.
 */

/**
 * Derive a bank ID from context and config.
 *
 * Static mode: returns config.bankId or DEFAULT_BANK_NAME.
 * Dynamic mode: composes from granularity fields joined by '::'.
 */
declare function deriveBankId(config: HindsightConfig, directory: string): string;

/**
 * Hindsight Kilo Plugin — persistent long-term memory for Kilo agents.
 *
 * Provides:
 * - Custom tools: hindsight_retain, hindsight_recall, hindsight_reflect
 * - Auto-retain on session.idle
 * - Memory injection on session.created via system transform
 * - Memory preservation during context compaction
 *
 * @example
 * ```json
 * // kilo.json
 * { "plugin": ["@kilocode/hindsight"] }
 *
 * // With options:
 * { "plugin": [["@kilocode/hindsight", { "bankId": "my-bank" }]] }
 * ```
 */

declare const HindsightPlugin: Plugin;

export { type HindsightConfig, HindsightPlugin, type PluginState, HindsightPlugin as default, deriveBankId, loadConfig };
