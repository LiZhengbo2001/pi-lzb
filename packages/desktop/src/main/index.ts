import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { DesktopBridge } from "./desktop-bridge";

const packageDir = join(__dirname, "..", "..");

let mainWindow: BrowserWindow | null = null;
let bridge: DesktopBridge | null = null;

function createWindow(): BrowserWindow {
	const preloadPath = join(packageDir, "dist", "preload", "index.js");
	const htmlPath = join(packageDir, "dist", "renderer", "index.html");

	const windowOptions: BrowserWindowConstructorOptions = {
		width: 1200,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		title: "Pi Desktop",
		backgroundColor: "#1a1a2e",
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	};

	const win = new BrowserWindow(windowOptions);
	win.loadFile(htmlPath);
	return win;
}

app.whenReady().then(() => {
	mainWindow = createWindow();
	bridge = new DesktopBridge(mainWindow);
	bridge.init();
});

app.on("window-all-closed", () => {
	bridge?.destroy();
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (mainWindow === null) {
		mainWindow = createWindow();
		bridge = new DesktopBridge(mainWindow);
		bridge.init();
	}
});
