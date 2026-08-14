/**
 * Ablation configuration (experiment doc E2 single-factor switches).
 *
 * Every tuning feature in the experiment is exposed here as an independent
 * switch parsed from the `--ablation` CLI flag. Without the flag (or with
 * `none`) the config is DEFAULT_ABLATION: everything off — vanilla behavior
 * is byte-identical to the unmodified harness.
 *
 * Flag grammar (comma-separated tokens, optional =value):
 *   lite-prompt      A1  shortened system prompt
 *   lite-tools       B1  one-line tool descriptions
 *   few-shot=legacy|openai   A2  tool-call example appended to system prompt
 *   repair           F1/F2  plain-text JSON tool-call extraction
 *   retry[=N]        E1  parse-failure retries (default 2)
 *   idle[=N]         E3  consecutive text-only turns before replan prompt (default 3)
 *   max-turns[=N]    loop hard cap (default 25)
 *   all              convenience: lite-prompt + lite-tools + few-shot=legacy +
 *                    repair + retry=2 + idle=3 + max-turns=40
 *   none             everything off (default)
 */

export interface AblationConfig {
	litePrompt: boolean;
	liteTools: boolean;
	fewShot: "none" | "openai" | "legacy";
	repair: boolean;
	retries: number;
	idleThreshold: number;
	maxTurns: number;
}

export const DEFAULT_ABLATION: AblationConfig = {
	litePrompt: false,
	liteTools: false,
	fewShot: "none",
	repair: false,
	retries: 0,
	idleThreshold: 0,
	maxTurns: 0,
};

const ALL_ABLATION: AblationConfig = {
	litePrompt: true,
	liteTools: true,
	fewShot: "legacy",
	repair: true,
	retries: 2,
	idleThreshold: 3,
	maxTurns: 40,
};

function parseIntToken(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n < 0) {
		throw new Error(`Invalid ablation value: ${value}`);
	}
	return n;
}

export function parseAblationFlag(raw?: string): AblationConfig {
	const cfg: AblationConfig = { ...DEFAULT_ABLATION };
	if (!raw) return cfg;
	for (const token of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
		const [key, value] = token.split("=", 2);
		switch (key) {
			case "none":
				return { ...DEFAULT_ABLATION };
			case "all":
				return { ...ALL_ABLATION };
			case "lite-prompt":
				cfg.litePrompt = true;
				break;
			case "lite-tools":
				cfg.liteTools = true;
				break;
			case "few-shot":
				cfg.fewShot = value === "openai" ? "openai" : "legacy";
				break;
			case "repair":
				cfg.repair = true;
				break;
			case "retry":
				cfg.retries = parseIntToken(value, 2);
				break;
			case "idle":
				cfg.idleThreshold = parseIntToken(value, 3);
				break;
			case "max-turns":
				cfg.maxTurns = parseIntToken(value, 25);
				break;
			default:
				throw new Error(`Unknown ablation option: ${key}`);
		}
	}
	return cfg;
}

/**
 * B1 lite tool texts. Only entries present here are overridden when
 * `lite-tools` is on — unknown tools keep their official descriptions.
 */
export const LITE_TOOL_TEXT: Record<string, { description: string }> = {
	read: {
		description: "Read a file's contents (text or image). Use offset/limit for large files.",
	},
	edit: {
		description: "Edit a file with exact text replacement.",
	},
};

/**
 * A2 few-shot tool-call examples, one per call style. `legacy` matches the
 * old Ollama tool template ({"name","parameters"}) used by noprompt variants;
 * `openai` matches native tool_calls.
 */
export const FEW_SHOT_BLOCKS: Record<"openai" | "legacy", string> = {
	openai: `Example tool call (OpenAI format):
{"name":"read","arguments":{"path":"src/main.py"}}`,
	legacy: `Example tool call (legacy format):
{"name":"read","parameters":{"path":"src/main.py"}}`,
};
