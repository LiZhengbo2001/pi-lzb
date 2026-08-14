export interface SessionInfo {
	id: string;
	name: string;
	modelId: string;
	provider: string;
	thinkingLevel: string;
	createdAt: number;
}

export interface PiEvent {
	sessionId?: string;
	type: string;
	data: Record<string, unknown>;
}

type EventHandler = (event: PiEvent) => void;

class PiClient {
	private ws: WebSocket | null = null;
	private handlers = new Set<EventHandler>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	connect(): void {
		if (this.ws?.readyState === WebSocket.OPEN) return;

		// Node backend always listens on a fixed localhost port; in production
		// the renderer loads via tauri:// so location.host is wrong — hardcode.
		const url = "ws://localhost:1420";

		try {
			this.ws = new WebSocket(url);
			this.ws.onmessage = (e) => {
				try {
					const msg = JSON.parse(e.data);
					for (const h of this.handlers) h(msg);
				} catch { /* ignore */ }
			};
			this.ws.onclose = () => {
				this.reconnectTimer = setTimeout(() => this.connect(), 2000);
			};
			this.ws.onerror = () => {
				this.ws?.close();
			};
		} catch {
			this.reconnectTimer = setTimeout(() => this.connect(), 2000);
		}
	}

	send(msg: Record<string, unknown>): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	onEvent(handler: EventHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	get connected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}
}

export const piClient = new PiClient();
