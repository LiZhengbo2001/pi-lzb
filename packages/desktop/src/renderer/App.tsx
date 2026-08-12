import React, { useState } from "react";
import { usePiClient } from "./hooks/usePiClient";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";

export function App() {
	const pi = usePiClient();
	const [input, setInput] = useState("");

	const handleCreate = () => pi.createSession();

	const handleSubmit = () => {
		if (!input.trim()) return;
		pi.prompt(input);
		setInput("");
	};

	if (!pi.activeSession) {
		return React.createElement("div", { className: "chat-empty" },
			React.createElement("h2", null, "Pi Desktop"),
			React.createElement("p", null,
				pi.connected ? "WebSocket connected" : "Connecting..."),
			React.createElement("button", {
				className: "new-session-btn",
				onClick: handleCreate,
				disabled: !pi.connected,
			}, "New Session"),
		);
	}

	return React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100vh" } },
		React.createElement("div", { className: "header" },
			React.createElement("div", null,
				React.createElement("h1", null, pi.activeSession.name),
				React.createElement("span", { className: "model-info" },
					pi.activeSession.modelId, " | ",
					pi.connected ? "connected" : "offline"),
			),
			React.createElement("button", { onClick: handleCreate }, "New"),
		),
		React.createElement(ChatView, { events: pi.events, sessionId: pi.activeSession.id }),
		React.createElement(InputBar, {
			value: input,
			onChange: setInput,
			onSubmit: handleSubmit,
			onAbort: pi.abort,
		}),
	);
}
