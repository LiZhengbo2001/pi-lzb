// 桥接扩展：从模型文本输出中捞 JSON tool call，直接执行
// 解决小模型不会输出标准 OpenAI tool_calls 的问题
// 开关: .pi/tool-debug.json → showToolCalls: true/false

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
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

// 从文本中提取 JSON tool call
function extractToolCall(text: string): { name: string; args: Record<string, any> } | null {
  // 匹配 {"name":"write","arguments":{...}} 或 {"name":"read",...
  const re = /\{\s*"name"\s*:\s*"(write|read|bash|edit|grep)"\s*,\s*"arguments"\s*:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/s;
  const m = text.match(re);
  if (!m) return null;
  try {
    return { name: m[1], args: JSON.parse(m[2]) };
  } catch {
    return null;
  }
}

// 直接写文件（绕过 Pi 工具系统）
function doWrite(cwd: string, filePath: string, content: string): string {
  const resolved = isAbsolute(filePath) ? filePath : join(cwd, filePath);
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(resolved, content, "utf-8");
  return resolved;
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    const cwd = (ctx as any).session?.getCwd?.() ?? process.cwd();
    if (!isEnabled(cwd)) return;

    for (const msg of event.messages) {
      if ((msg as any).role !== "assistant") continue;

      const textBlocks = ((msg as any).content ?? []).filter((c: any) => c.type === "text");
      for (const block of textBlocks) {
        const text: string = typeof block.text === "string" ? block.text : "";
        if (!text || text.length < 10) continue;

        const parsed = extractToolCall(text);
        if (!parsed) continue;

        ctx.ui.notify(`[bridge] found: ${parsed.name}(${JSON.stringify(parsed.args).slice(0, 150)})`, "info");

        if (parsed.name === "write") {
          try {
            const fp = parsed.args.file_path ?? parsed.args.path ?? "output.txt";
            const content = parsed.args.content ?? "";
            const dest = doWrite(cwd, fp, content);
            ctx.ui.notify(`[bridge] wrote: ${dest}`, "info");
          } catch (e: any) {
            ctx.ui.notify(`[bridge] write failed: ${e.message}`, "info");
          }
        }
      }
    }
  });
}
