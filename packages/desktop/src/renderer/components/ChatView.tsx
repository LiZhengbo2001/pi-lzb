import React, { useEffect, useRef, useState } from "react";
import type { PiEvent } from "../lib/ipc-client";

interface ChatViewProps {
	events: PiEvent[];
	sessionId: string;
}

interface Message {
	id: string;
	role: "user" | "assistant" | "tool" | "thinking" | "error";
	content: string;
	toolName?: string;
	toolArgs?: string;
	toolResult?: string;
	collapsed?: boolean;
}

function parseEvents(events: PiEvent[]): Message[] {
	const messages: Message[] = [];
	let currentAssistant: Message | null = null;

	for (const event of events) {
		const d = event.data as Record<string, unknown>;

		switch (event.type) {
			case "user_message":
				messages.push({
					id: `user-${messages.length}`,
					role: "user",
					content: (d.text as string) ?? (d.message as string) ?? "",
				});
				currentAssistant = null;
				break;

			case "assistant_text": {
				const text = (d.text as string) ?? (d.delta as string) ?? "";
				if (!currentAssistant) {
					currentAssistant = { id: `asst-${messages.length}`, role: "assistant", content: "" };
					messages.push(currentAssistant);
				}
				currentAssistant.content += text;
				break;
			}

			case "assistant_thinking": {
				const thinking = (d.text as string) ?? (d.delta as string) ?? "";
				messages.push({
					id: `think-${messages.length}`,
					role: "thinking",
					content: thinking,
					collapsed: true,
				});
				break;
			}

			case "tool_start":
				messages.push({
					id: `tool-${messages.length}`,
					role: "tool",
					content: `Running ${d.name ?? "tool"}...`,
					toolName: d.name as string,
					toolArgs: JSON.stringify(d.args ?? {}, null, 2),
				});
				currentAssistant = null;
				break;

			case "tool_result":
				messages.push({
					id: `toolres-${messages.length}`,
					role: "tool",
					content: "Done",
					toolResult: (d.result as string) ?? JSON.stringify(d.result ?? {}, null, 2),
				});
				currentAssistant = null;
				break;

			case "error":
				messages.push({
					id: `err-${messages.length}`,
					role: "error",
					content: (d.message as string) ?? "Unknown error",
				});
				currentAssistant = null;
				break;

			case "agent_end":
				currentAssistant = null;
				break;
		}
	}

	return messages;
}

export function ChatView({ events, sessionId }: ChatViewProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [messages, setMessages] = useState<Message[]>([]);

	useEffect(() => {
		setMessages(parseEvents(events));
	}, [events]);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages]);

	return React.createElement("div", { className: "chat-container", ref: scrollRef },
		messages.length === 0
			? React.createElement("div", { className: "chat-empty" },
					React.createElement("p", null, "发送消息开始对话..."),
				)
			: messages.map((msg) => {
					if (msg.role === "thinking") {
						return React.createElement("div", {
							key: msg.id,
							className: `thinking ${msg.collapsed ? "collapsed" : ""}`,
							onClick: (e: React.MouseEvent) => {
								(e.target as HTMLElement).classList.toggle("collapsed");
							},
						}, msg.content.slice(0, msg.collapsed ? 100 : undefined));
					}

					if (msg.role === "tool") {
						return React.createElement("div", { key: msg.id, className: "tool-call" },
							React.createElement("div", { className: "tool-header" },
								React.createElement("span", null, msg.toolName ?? "tool"),
							),
							msg.toolArgs && React.createElement("div", { className: "tool-body" },
								React.createElement("pre", null, msg.toolArgs),
							),
							msg.toolResult && React.createElement("div", { className: "tool-body" },
								React.createElement("pre", null, msg.toolResult.slice(0, 2000)),
							),
						);
					}

					if (msg.role === "error") {
						return React.createElement("div", {
							key: msg.id,
							className: "message assistant",
							style: { color: "var(--error)" },
						}, msg.content);
					}

					return React.createElement("div", {
						key: msg.id,
						className: `message ${msg.role}`,
					}, msg.content);
				}),
	);
}
