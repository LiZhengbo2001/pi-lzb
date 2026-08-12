/**
 * Agent backend server for Tauri desktop app.
 *
 * Serves the React UI and provides WebSocket for real-time agent events.
 * Started as a child process by the Tauri Rust shell.
 */

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
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

// WebSocket for agent events
const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

httpServer.on("upgrade", (req, socket: Socket, head) => {
	wss.handleUpgrade(req, socket, head, (ws) => {
		clients.add(ws);
		ws.on("close", () => clients.delete(ws));
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				handleMessage(ws, msg);
			} catch {
				// Ignore malformed messages
			}
		});
		ws.send(JSON.stringify({ type: "connected", sessionId: null }));
	});
});

interface WsMessage {
	type: string;
	text?: string;
	sessionId?: string;
}

function handleMessage(ws: WebSocket, msg: WsMessage): void {
	switch (msg.type) {
		case "prompt": {
			// Stub: echo back after a delay
			const sessionId = msg.sessionId ?? randomUUID();
			setTimeout(() => {
				ws.send(JSON.stringify({
					type: "assistant_text",
					sessionId,
					data: { text: "Agent backend connecting...\n\nTauri desktop app is running.\nWebSocket is active on port " + PORT + "." },
				}));
			}, 500);
			break;
		}
		case "create_session": {
			const id = randomUUID();
			ws.send(JSON.stringify({
				type: "session_created",
				data: { id, name: `Session ${id.slice(0, 6)}`, modelId: "deepseek-chat", provider: "deepseek", thinkingLevel: "medium", createdAt: Date.now() },
			}));
			break;
		}
		default:
			break;
	}
}

httpServer.listen(PORT, () => {
	console.log(`Pi Desktop server running on http://localhost:${PORT}`);
});
