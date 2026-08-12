import React, { useState } from "react";
import { usePiClient } from "./hooks/usePiClient";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";

export function App() {
	const pi = usePiClient();
	const [input, setInput] = useState("");

	const handleCreate = async () => {
		await pi.createSession();
	};

	const handleSubmit = async () => {
		if (!input.trim()) return;
		const text = input;
		setInput("");
		await pi.prompt(text);
	};

	if (!pi.activeSession) {
		return React.createElement("div", { className: "chat-empty" },
			React.createElement("h2", null, "Pi Desktop"),
			React.createElement("p", null, "编程助手的桌面版"),
			React.createElement("button", {
				className: "new-session-btn",
				onClick: handleCreate,
				disabled: pi.loading,
			}, pi.loading ? "创建中..." : "新建会话"),
		);
	}

	return React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100vh" } },
		React.createElement("div", { className: "header" },
			React.createElement("div", null,
				React.createElement("h1", null, pi.activeSession.name),
				React.createElement("span", { className: "model-info" },
					pi.activeSession.modelId, " — ", pi.activeSession.thinkingLevel),
			),
			React.createElement("button", { onClick: handleCreate }, "新建"),
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
