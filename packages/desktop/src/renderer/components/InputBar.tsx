import React from "react";

interface InputBarProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onAbort: () => void;
}

export function InputBar({ value, onChange, onSubmit, onAbort }: InputBarProps) {
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			onSubmit();
		}
	};

	return React.createElement("div", { className: "input-bar" },
		React.createElement("input", {
			type: "text",
			placeholder: "输入消息... (Enter 发送, Ctrl+C 中止)",
			value,
			onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
			onKeyDown: handleKeyDown,
		}),
		React.createElement("button", { onClick: onSubmit, disabled: !value.trim() }, "发送"),
		React.createElement("button", { onClick: onAbort, style: { background: "var(--warning)" } }, "中止"),
	);
}
