/**
 * Agent backend server for Tauri desktop app.
 *
 * Serves the React UI and provides WebSocket for real-time agent events.
 * Started as a child process by the Tauri Rust shell.
 *
 * Runs the real coding-agent in-process via createAgentSession and maps
 * AgentSessionEvent onto the JSON WebSocket events the renderer consumes.
 */

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";

const PORT = 1420;
const DIST_DIR = process.env.PI_SERVE_DIR || join(__dirname, "..", "..", "dist", "renderer");

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".map": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

function serveStatic(req: IncomingMessage): { body: Buffer; mime: string; status: number } | null {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
	let filePath = join(DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname);

	if (!existsSync(filePath)) {
		// SPA fallback
		filePath = join(DIST_DIR, "index.html");
	}

	if (!existsSync(filePath)) {
		return { body: Buffer.from("Not Found"), mime: "text/plain", status: 404 };
	}

	const ext = extname(filePath).toLowerCase();
	return {
		body: readFileSync(filePath),
		mime: MIME[ext] ?? "application/octet-stream",
		status: 200,
	};
}

const httpServer = createServer((req, res) => {
	const result = serveStatic(req);
	if (result) {
		res.writeHead(result.status, { "Content-Type": result.mime });
		res.end(result.body);
	}
});

// ---------------------------------------------------------------------------
// Agent backend
// ---------------------------------------------------------------------------

interface ActiveSession {
	id: string;
	name: string;
	modelId: string;
	provider: string;
	thinkingLevel: string;
	createdAt: number;
	cwd: string;
	agent: AgentSessionLike;
	unsubscribe: () => void;
}

// Loose structural type — avoids a hard ESM type import into this CJS module.
interface AgentSessionLike {
	thinkingLevel?: string;
	model?: { provider?: string; id?: string };
	subscribe(listener: (event: Record<string, any>) => void): () => void;
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	dispose(): void;
}

const sessions = new Map<string, ActiveSession>();
const wsToSession = new Map<WebSocket, string>();

// coding-agent is ESM-only and lives behind a lazy dynamic import so the CJS
// bundle does not emit `require()` against an ESM package (ERR_REQUIRE_ESM).
let createAgentSession: any;
let getModel: any;

async function loadAgentDeps(): Promise<void> {
	if (createAgentSession && getModel) return;
	const codingAgent = await import("@earendil-works/pi-coding-agent");
	const aiCompat = await import("@earendil-works/pi-ai/compat");
	createAgentSession = codingAgent.createAgentSession;
	getModel = aiCompat.getModel;
}

function send(ws: WebSocket, msg: Record<string, unknown>): void {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

function translateEvent(ws: WebSocket, sessionId: string, event: Record<string, any>): void {
	switch (event.type) {
		case "message_update": {
			const inner = event.assistantMessageEvent;
			if (inner?.type === "text_delta") {
				send(ws, { type: "assistant_text", sessionId, data: { text: inner.delta } });
			} else if (inner?.type === "thinking_delta") {
				send(ws, { type: "assistant_thinking", sessionId, data: { text: inner.delta } });
			}
			break;
		}
		case "tool_execution_start":
			send(ws, { type: "tool_start", sessionId, data: { name: event.toolName, args: event.args } });
			break;
		case "tool_execution_end":
			send(ws, {
				type: "tool_result",
				sessionId,
				data: { name: event.toolName, result: event.result, isError: event.isError },
			});
			break;
		case "agent_end":
		case "turn_end":
			send(ws, { type: "agent_end", sessionId, data: {} });
			break;
		default:
			break;
	}
}

interface WsMessage {
	type: string;
	text?: string;
	sessionId?: string;
	cwd?: string;
	provider?: string;
	modelId?: string;
}

async function createSession(ws: WebSocket, msg: WsMessage): Promise<void> {
	await loadAgentDeps();
	if (!createAgentSession || !getModel) {
		send(ws, { type: "error", data: { message: "Agent backend not available" } });
		return;
	}

	const provider = msg.provider ?? "deepseek";
	const modelId = msg.modelId ?? "deepseek-v4-flash";
	const cwd = msg.cwd && msg.cwd.trim() ? msg.cwd.trim() : process.cwd();

	let model = getModel(provider, modelId);
	if (!model && msg.modelId) {
		// Requested model id not in the catalog — fall back to a known-good id.
		model = getModel(provider, "deepseek-v4-flash");
	}
	if (!model) {
		send(ws, { type: "error", data: { message: `Model not found: ${provider}/${modelId}` } });
		return;
	}

	const { session } = await createAgentSession({ cwd, model });
	const id = randomUUID();
	const name = basename(cwd) || "会话";
	const thinkingLevel = session.thinkingLevel ?? "medium";

	const unsubscribe = session.subscribe((event: Record<string, any>) => translateEvent(ws, id, event));

	const active: ActiveSession = {
		id,
		name,
		modelId: model.id ?? modelId,
		provider: model.provider ?? provider,
		thinkingLevel,
		createdAt: Date.now(),
		cwd,
		agent: session,
		unsubscribe,
	};

	sessions.set(id, active);
	wsToSession.set(ws, id);

	send(ws, {
		type: "session_created",
		data: {
			id,
			name,
			modelId: active.modelId,
			provider: active.provider,
			thinkingLevel,
			createdAt: active.createdAt,
		},
	});
}

async function prompt(ws: WebSocket, msg: WsMessage): Promise<void> {
	const sessionId = msg.sessionId;
	const active = sessionId ? sessions.get(sessionId) : undefined;
	if (!active) {
		send(ws, { type: "error", data: { message: "No active session" } });
		return;
	}
	const text = msg.text;
	if (!text || !text.trim()) return;
	send(ws, { type: "user_message", sessionId, data: { text } });
	await active.agent.prompt(text);
}

async function abort(ws: WebSocket, msg: WsMessage): Promise<void> {
	const active = msg.sessionId ? sessions.get(msg.sessionId) : undefined;
	if (active) {
		await active.agent.abort();
	}
}

async function handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
	try {
		switch (msg.type) {
			case "create_session":
				await createSession(ws, msg);
				break;
			case "prompt":
				await prompt(ws, msg);
				break;
			case "abort":
				await abort(ws, msg);
				break;
			default:
				break;
		}
	} catch (err) {
		console.error("handleMessage error:", err);
		send(ws, { type: "error", data: { message: err instanceof Error ? err.message : String(err) } });
	}
}

// WebSocket for agent events
const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

httpServer.on("upgrade", (req, socket: Socket, head) => {
	wss.handleUpgrade(req, socket, head, (ws) => {
		clients.add(ws);
		ws.on("close", () => {
			clients.delete(ws);
			const sessionId = wsToSession.get(ws);
			if (sessionId) {
				wsToSession.delete(ws);
				const active = sessions.get(sessionId);
				if (active) {
					active.unsubscribe();
					try {
						active.agent.dispose();
					} catch {
						// Ignore dispose errors on teardown
					}
					sessions.delete(sessionId);
				}
			}
		});
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString()) as WsMessage;
				void handleMessage(ws, msg);
			} catch {
				// Ignore malformed messages
			}
		});
		ws.send(JSON.stringify({ type: "connected", sessionId: null }));
	});
});

httpServer.listen(PORT, () => {
	console.log(`Pi Desktop server running on http://localhost:${PORT}`);
});
