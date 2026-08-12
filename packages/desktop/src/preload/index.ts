import { contextBridge, ipcRenderer } from "electron";

const api = {
	createSession: (): Promise<unknown> => ipcRenderer.invoke("pi:createSession"),
	prompt: (text: string): Promise<void> => ipcRenderer.invoke("pi:prompt", text),
	steer: (text: string): Promise<void> => ipcRenderer.invoke("pi:steer", text),
	abort: (): Promise<void> => ipcRenderer.invoke("pi:abort"),
	setThinking: (level: string): Promise<void> => ipcRenderer.invoke("pi:setThinking", level),
	getActiveSession: (): Promise<unknown> => ipcRenderer.invoke("pi:getActiveSession"),
	onEvent: (callback: (event: unknown) => void): (() => void) => {
		const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data);
		ipcRenderer.on("pi:event", handler);
		return () => ipcRenderer.removeListener("pi:event", handler);
	},
};

contextBridge.exposeInMainWorld("pi", api);

export type PiApi = typeof api;
