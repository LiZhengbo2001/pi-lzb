import { useState, useEffect, useCallback } from "react";
import { piClient, type PiEvent, type SessionInfo } from "../lib/ipc-client";

export function usePiClient() {
	const [connected, setConnected] = useState(false);
	const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
	const [events, setEvents] = useState<PiEvent[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		piClient.connect();
		const unsub = piClient.onEvent((event) => {
			switch (event.type) {
				case "connected":
					setConnected(true);
					break;
				case "session_created":
					setActiveSession(event.data as unknown as SessionInfo);
					setEvents([]);
					break;
				default:
					setEvents((prev) => [...prev, event]);
					break;
			}
		});

		return () => {
			unsub();
			setConnected(false);
		};
	}, []);

	const createSession = useCallback(async (cwd?: string) => {
		setLoading(true);
		piClient.send({ type: "create_session", cwd });
		setLoading(false);
	}, []);

	const prompt = useCallback(async (text: string) => {
		piClient.send({ type: "prompt", text, sessionId: activeSession?.id });
	}, [activeSession]);

	const abort = useCallback(async () => {
		piClient.send({ type: "abort", sessionId: activeSession?.id });
	}, [activeSession]);

	return {
		connected,
		activeSession,
		events,
		loading,
		createSession,
		prompt,
		abort,
	};
}
