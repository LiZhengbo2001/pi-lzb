// 显示模型原始输出 + tool_call 详情，用于调试小模型工具调用
// 开关在 .pi/tool-debug.json → showToolCalls: true/false
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isEnabled(cwd: string): boolean {
  try {
    const configPath = join(cwd, ".pi", "tool-debug.json");
    if (!existsSync(configPath)) return false;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config.showToolCalls === true;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  // 工具开始执行时立即显示（最可靠，不管模型输出什么格式都能捕获）
  pi.on("tool_execution_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    const cwd = (ctx as any).session?.getCwd?.() ?? process.cwd();
    if (!isEnabled(cwd)) return;

    const argsStr = JSON.stringify(event.args);
    const display = argsStr.length > 300 ? argsStr.slice(0, 300) + "…" : argsStr;
    ctx.ui.notify(`[tool_call] ${event.toolName}(${display})`, "info");
  });

  // agent 结束后显示模型文本输出（前 200 字符）
  pi.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    const cwd = (ctx as any).session?.getCwd?.() ?? process.cwd();
    if (!isEnabled(cwd)) return;

    for (const msg of event.messages) {
      if ((msg as any).role !== "assistant") continue;
      const textBlocks = ((msg as any).content ?? []).filter((c: any) => c.type === "text");
      for (const block of textBlocks) {
        const preview = typeof block.text === "string"
          ? block.text.slice(0, 200) + (block.text.length > 200 ? "…" : "")
          : "";
        if (preview) {
          ctx.ui.notify(`[模型输出] ${preview}`, "info");
        }
      }
    }
  });
}
