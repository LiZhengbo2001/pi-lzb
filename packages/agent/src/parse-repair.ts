/**
 * Tool-call parse repair (experiment doc F1/F2).
 *
 * Small local models (e.g. llama3.1/rnj/qwen2.5 via Ollama with the legacy
 * tool-call template) frequently emit tool calls as plain-text JSON instead
 * of provider-native tool_calls — with two shapes:
 *   F1 "openai":  {"name":"read","arguments":{...}}
 *   F2 "legacy":  {"name":"read","parameters":{...}}
 *
 * repairToolCalls() scans the text blocks of an assistant message, extracts
 * top-level `{...}` fragments, and rewrites tool-call-shaped ones into
 * ToolCall content blocks. Malformed-but-tool-call-shaped fragments (truncated
 * output, trailing commas, unclosed braces) get lightweight JSON salvage;
 * fragments that still fail to parse are reported via `error` so the loop can
 * feed them back to the model (E1 retry).
 *
 * This module only mutates a message in place — it is dead code unless the
 * loop is explicitly configured with `parseRepair` (ablation switch, default
 * off; vanilla behavior is byte-identical).
 */

import { randomUUID } from "node:crypto";
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";

export type ToolCallJsonStyle = "openai" | "legacy" | "both";

export interface RepairResult {
	/** True when message.content was rewritten. */
	changed: boolean;
	/** The same message object, with tool calls extracted from text blocks. */
	message: AssistantMessage;
	/** Number of toolCall blocks extracted. */
	repairedCount: number;
	/** First tool-call-shaped fragment that could not be parsed (for E1 retry feedback). */
	error?: string;
}

interface JsonFragment {
	fragment: string;
	start: number;
	end: number;
}

/** Bracket-balanced scan for top-level { ... } fragments (regex can't handle nesting). */
function extractTopLevelJson(text: string): JsonFragment[] {
	const out: JsonFragment[] = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		if (text[i] !== "{") {
			i++;
			continue;
		}
		let depth = 1;
		let j = i + 1;
		let inStr = false;
		let esc = false;
		while (j < n && depth > 0) {
			const c = text[j];
			if (inStr) {
				if (esc) esc = false;
				else if (c === "\\") esc = true;
				else if (c === '"') inStr = false;
			} else if (c === '"') {
				inStr = true;
			} else if (c === "{") {
				depth++;
			} else if (c === "}") {
				depth--;
			}
			j++;
		}
		if (depth === 0) {
			out.push({ fragment: text.slice(i, j), start: i, end: j });
			i = j;
		} else if (j >= n) {
			// Unbalanced fragment reaching end-of-text: a truncated tool call.
			// Keep it as a candidate — tryParseJson's balanceAndClose may salvage it.
			out.push({ fragment: text.slice(i, j), start: i, end: j });
			i = j;
		} else {
			i++;
		}
	}
	return out;
}

function looksLikeToolCall(fragment: string, style: ToolCallJsonStyle): boolean {
	if (!/"name"\s*:/.test(fragment)) return false;
	const hasArguments = /"arguments"\s*:/.test(fragment);
	const hasParameters = /"parameters"\s*:/.test(fragment);
	if (!hasArguments && !hasParameters) return false;
	if (style === "openai") return hasArguments;
	if (style === "legacy") return hasParameters;
	return true;
}

function stripTrailingCommas(s: string): string {
	return s.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Close unclosed braces on truncated output (best effort). Unterminated
 * strings are left alone — auto-closing a quote would invent argument data,
 * so those fragments fail parsing and surface as `error` instead.
 */
function balanceAndClose(s: string): string {
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (const ch of s) {
		if (inStr) {
			if (esc) esc = false;
			else if (ch === "\\") esc = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') inStr = true;
		else if (ch === "{") depth++;
		else if (ch === "}") depth--;
	}
	return s + "}".repeat(Math.max(depth, 0));
}

function tryParseJson(fragment: string): unknown | undefined {
	const attempts = [
		fragment,
		stripTrailingCommas(fragment),
		balanceAndClose(fragment),
		balanceAndClose(stripTrailingCommas(fragment)),
	];
	for (const a of attempts) {
		try {
			return JSON.parse(a);
		} catch {
			// next attempt
		}
	}
	return undefined;
}

/**
 * Extract tool calls embedded as plain-text JSON inside an assistant message.
 * Mutates and returns the same message object.
 */
export function repairToolCalls(message: AssistantMessage, style: ToolCallJsonStyle = "both"): RepairResult {
	const newContent: (TextContent | ThinkingContent | ToolCall)[] = [];
	let repairedCount = 0;
	let error: string | undefined;
	let changed = false;

	for (const block of message.content) {
		if (block.type !== "text") {
			newContent.push(block);
			continue;
		}

		const text = block.text;
		const candidates = extractTopLevelJson(text);
		let last = 0;
		for (const c of candidates) {
			if (!looksLikeToolCall(c.fragment, style)) continue;

			const parsed = tryParseJson(c.fragment);
			if (parsed === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				error = error ?? `unparseable tool call: ${c.fragment.slice(0, 200)}`;
				continue;
			}

			const obj = parsed as Record<string, unknown>;
			const name = typeof obj.name === "string" ? obj.name : undefined;
			const rawArgs = "arguments" in obj ? obj.arguments : obj.parameters;
			if (!name || typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
				error = error ?? `tool call missing name/arguments: ${c.fragment.slice(0, 200)}`;
				continue;
			}

			const leading = text.slice(last, c.start);
			if (leading.trim()) {
				newContent.push({ type: "text", text: leading });
			}
			newContent.push({
				type: "toolCall",
				id: `call_${randomUUID()}`,
				name,
				arguments: rawArgs as Record<string, any>,
			});
			repairedCount++;
			changed = true;
			last = c.end;
		}

		const tail = text.slice(last);
		if (tail.trim()) {
			newContent.push({ type: "text", text: tail });
		}
	}

	if (changed) {
		message.content = newContent;
	}
	return { changed, message, repairedCount, error };
}
