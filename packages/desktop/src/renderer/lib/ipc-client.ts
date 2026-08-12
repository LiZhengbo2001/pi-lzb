interface PiApi {
	createSession(): Promise<SessionInfo>;
	prompt(text: string): Promise<void>;
	steer(text: string): Promise<void>;
	abort(): Promise<void>;
	setThinking(level: string): Promise<void>;
	getActiveSession(): Promise<SessionInfo | null>;
	onEvent(callback: (event: PiEvent) => void): () => void;
}

export interface SessionInfo {
	id: string;
	name: string;
	modelId: string;
	provider: string;
	thinkingLevel: string;
	createdAt: number;
}

export interface PiEvent {
	sessionId: string;
	type: string;
	data: Record<string, unknown>;
}

declare global {
	interface Window {
		pi: PiApi;
	}
}

export function getPi(): PiApi {
	if (!window.pi) {
		throw new Error("Pi API not available. Ensure preload script loaded.");
	}
	return window.pi;
}
