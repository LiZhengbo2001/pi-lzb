import { useState, useEffect, useCallback } from "react";
import { getPi, type PiEvent, type SessionInfo } from "../lib/ipc-client";

export function usePiClient() {
	const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
	const [events, setEvents] = useState<PiEvent[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const pi = getPi();
		const unsubscribe = pi.onEvent((event) => {
			setEvents((prev) => [...prev, event]);
		});
		return unsubscribe;
	}, []);

	const createSession = useCallback(async () => {
		setLoading(true);
		try {
			const pi = getPi();
			const session = await pi.createSession();
			setActiveSession(session);
			setEvents([]);
			return session;
		} finally {
			setLoading(false);
		}
	}, []);

	const prompt = useCallback(async (text: string) => {
		const pi = getPi();
		await pi.prompt(text);
	}, []);

	const steer = useCallback(async (text: string) => {
		const pi = getPi();
		await pi.steer(text);
	}, []);

	const abort = useCallback(async () => {
		const pi = getPi();
		await pi.abort();
	}, []);

	const setThinking = useCallback(async (level: string) => {
		const pi = getPi();
		await pi.setThinking(level);
	}, []);

	return {
		activeSession,
		events,
		loading,
		createSession,
		prompt,
		steer,
		abort,
		setThinking,
	};
}
