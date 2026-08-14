import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { repairToolCalls } from "../src/parse-repair.ts";

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

describe("repairToolCalls", () => {
	it("F1: extracts an openai-style tool call from a text block", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: 'I will read the file. {"name":"read","arguments":{"path":"src/main.py"}}' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.changed).toBe(true);
		expect(res.repairedCount).toBe(1);
		expect(res.error).toBeUndefined();
		const calls = res.message.content.filter((c) => c.type === "toolCall");
		expect(calls).toHaveLength(1);
		expect(calls[0].type).toBe("toolCall");
		const call = calls[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
		expect(call.name).toBe("read");
		expect(call.arguments).toEqual({ path: "src/main.py" });
	});

	it("F2: maps legacy `parameters` to `arguments`", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"read","parameters":{"path":"a.txt"}}' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(1);
		const call = res.message.content.find((c) => c.type === "toolCall") as Extract<
			AssistantMessage["content"][number],
			{ type: "toolCall" }
		>;
		expect(call.arguments).toEqual({ path: "a.txt" });
	});

	it("style=openai ignores legacy fragments", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"read","parameters":{"path":"a.txt"}}' },
		]);
		const res = repairToolCalls(msg, "openai");
		expect(res.changed).toBe(false);
		expect(res.repairedCount).toBe(0);
	});

	it("style=legacy ignores openai fragments", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"read","arguments":{"path":"a.txt"}}' },
		]);
		const res = repairToolCalls(msg, "legacy");
		expect(res.changed).toBe(false);
		expect(res.repairedCount).toBe(0);
	});

	it("extracts from markdown fenced blocks", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: 'Here is the call:\n```json\n{"name":"read","arguments":{"path":"a.txt"}}\n```\nDone.' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(1);
		expect(res.message.content.filter((c) => c.type === "toolCall")).toHaveLength(1);
	});

	it("salvages truncated JSON (unclosed brace)", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"edit","arguments":{"path":"a.txt","edits":[{"old":"x","new":"y"}]}' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(1);
		const call = res.message.content.find((c) => c.type === "toolCall") as Extract<
			AssistantMessage["content"][number],
			{ type: "toolCall" }
		>;
		expect(call.arguments).toEqual({ path: "a.txt", edits: [{ old: "x", new: "y" }] });
	});

	it("salvages trailing commas", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"read","arguments":{"path":"a.txt",},}' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(1);
	});

	it("extracts multiple calls from one text block", () => {
		const msg = createAssistantMessage([
			{
				type: "text",
				text: '{"name":"read","arguments":{"path":"a.txt"}} then {"name":"read","arguments":{"path":"b.txt"}}',
			},
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(2);
	});

	it("preserves native toolCall blocks and surrounding prose", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: 'Let me look. {"name":"read","parameters":{"path":"a.txt"}} thanks.' },
			{ type: "toolCall", id: "call_native", name: "bash", arguments: { command: "ls" } },
		]);
		const res = repairToolCalls(msg, "both");
		const calls = res.message.content.filter((c) => c.type === "toolCall");
		expect(calls).toHaveLength(2);
		const texts = res.message.content.filter((c) => c.type === "text");
		expect(texts.map((t) => (t as { text: string }).text).join("")).toContain("Let me look");
	});

	it("ignores prose that mentions name but is not JSON", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: 'My name is "read" and these are my arguments for the plan.' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.changed).toBe(false);
		expect(res.repairedCount).toBe(0);
		expect(res.error).toBeUndefined();
	});

	it("sets error for tool-call-shaped but unparseable JSON", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"read","arguments":{"path": "unclosed' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(0);
		expect(res.error).toBeDefined();
		expect(res.error).toContain("unparseable tool call");
	});

	it("sets error when parsed object has no usable name/arguments", () => {
		const msg = createAssistantMessage([
			{ type: "text", text: '{"name":"read","arguments":"not-an-object"}' },
		]);
		const res = repairToolCalls(msg, "both");
		expect(res.repairedCount).toBe(0);
		expect(res.error).toBeDefined();
	});
});
