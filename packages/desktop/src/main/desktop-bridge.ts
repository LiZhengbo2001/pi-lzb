/**
 * Desktop bridge — stub implementation.
 *
 * Registers IPC handlers that the React UI calls.
 * Agent backend integration to be wired up in a later phase.
 */

import { ipcMain, type BrowserWindow } from "electron";

export interface SessionInfo {
	id: string;
	name: string;
	modelId: string;
	provider: string;
	thinkingLevel: string;
	createdAt: number;
}

export class DesktopBridge {
	private sessionCounter = 0;

	constructor(private mainWindow: BrowserWindow) {}

	init(): void {
		ipcMain.handle("pi:createSession", async () => this.createSession());
		ipcMain.handle("pi:prompt", async (_e, _text: string) => this.prompt());
		ipcMain.handle("pi:steer", async (_e, _text: string) => {});
		ipcMain.handle("pi:abort", async () => {});
		ipcMain.handle("pi:setThinking", async (_e, _level: string) => {});
		ipcMain.handle("pi:getActiveSession", async () => this.getActiveSessionInfo());
	}

	private async createSession(): Promise<SessionInfo> {
		this.sessionCounter++;
		const session: SessionInfo = {
			id: `session-${this.sessionCounter}`,
			name: `会话 ${this.sessionCounter}`,
			modelId: "deepseek-chat",
			provider: "deepseek",
			thinkingLevel: "medium",
			createdAt: Date.now(),
		};

		// Notify renderer
		if (!this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("pi:event", {
				sessionId: session.id,
				type: "session_created",
				data: session,
			});
		}

		return session;
	}

	private async prompt(): Promise<void> {
		// Stub: send echo response after delay
		if (!this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("pi:event", {
				sessionId: `session-${this.sessionCounter}`,
				type: "assistant_text",
				data: { text: "Agent 后端正在连接中...\n\n当前为 UI 预览模式。Agent 集成将在后续版本中完成。" },
			});
		}
	}

	private async getActiveSessionInfo(): Promise<SessionInfo | null> {
		if (this.sessionCounter === 0) return null;
		return {
			id: `session-${this.sessionCounter}`,
			name: `会话 ${this.sessionCounter}`,
			modelId: "deepseek-chat",
			provider: "deepseek",
			thinkingLevel: "medium",
			createdAt: Date.now(),
		};
	}

	destroy(): void {
		ipcMain.removeHandler("pi:createSession");
		ipcMain.removeHandler("pi:prompt");
		ipcMain.removeHandler("pi:steer");
		ipcMain.removeHandler("pi:abort");
		ipcMain.removeHandler("pi:setThinking");
		ipcMain.removeHandler("pi:getActiveSession");
	}
}
