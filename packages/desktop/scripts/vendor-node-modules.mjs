/**
 * Materialize a production `node_modules` tree next to the bundled server so
 * the packaged exe can resolve `@earendil-works/*` (workspace symlinks) and
 * their third-party deps at runtime, without shipping the whole monorepo.
 *
 * Output: dist/server/node_modules/
 *   - @earendil-works/*  -> real dirs (packages/<pkg>/dist + package.json)
 *   - third-party deps   -> real dirs copied from the hoisted node_modules
 */

import { readFileSync, existsSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopDir));
const packagesDir = join(repoRoot, "packages");
const nodeModules = join(repoRoot, "node_modules");
const vendor = join(desktopDir, "dist", "server", "node_modules");

// Workspace package name -> directory name under packages/
const WORKSPACE = {
	"pi-coding-agent": "coding-agent",
	"pi-ai": "ai",
	"pi-agent-core": "agent",
	"pi-client": "client",
	"pi-protocol": "protocol",
	"pi-server": "server",
	"pi-tui": "tui",
	"pi-telemetry": "telemetry",
};

function readJson(p) {
	try {
		return JSON.parse(readFileSync(p, "utf8"));
	} catch {
		return null;
	}
}

function resolveThirdPartyJson(name) {
	// scoped: @scope/pkg -> node_modules/@scope/pkg/package.json
	const p = join(nodeModules, name, "package.json");
	if (existsSync(p)) return p;
	return null;
}

/** BFS the third-party dependency closure starting from the workspace deps. */
function collectThirdParty() {
	const queue = [];
	const seen = new Set();

	for (const name of Object.keys(WORKSPACE)) {
		const pkg = readJson(join(packagesDir, WORKSPACE[name], "package.json"));
		for (const dep of Object.keys({
			...(pkg?.dependencies ?? {}),
			...(pkg?.optionalDependencies ?? {}),
		})) {
			if (!dep.startsWith("@earendil-works/")) queue.push(dep);
		}
	}

	while (queue.length) {
		const name = queue.pop();
		if (seen.has(name)) continue;
		seen.add(name);

		const pkgPath = resolveThirdPartyJson(name);
		if (!pkgPath) {
			console.warn(`[vendor] missing third-party package: ${name}`);
			continue;
		}
		const pkg = readJson(pkgPath);
		for (const dep of Object.keys({
			...(pkg?.dependencies ?? {}),
			...(pkg?.optionalDependencies ?? {}),
		})) {
			if (!dep.startsWith("@earendil-works/")) queue.push(dep);
		}
	}

	return seen;
}

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });

// 1. Workspace packages (real dirs: dist + package.json)
for (const [name, dir] of Object.entries(WORKSPACE)) {
	const srcDist = join(packagesDir, dir, "dist");
	const srcPkg = join(packagesDir, dir, "package.json");
	const dst = join(vendor, "@earendil-works", name);
	mkdirSync(dst, { recursive: true });
	if (existsSync(srcDist)) cpSync(srcDist, join(dst, "dist"), { recursive: true, dereference: true });
	if (existsSync(srcPkg)) cpSync(srcPkg, join(dst, "package.json"));
	console.log(`[vendor] workspace ${name} -> ${dst}`);
}

// 2. Third-party deps (copy real package dir, skip .bin + nested node_modules)
for (const name of collectThirdParty()) {
	const src = join(nodeModules, name);
	const dst = join(vendor, name);
	if (!existsSync(src)) {
		console.warn(`[vendor] skip missing dir: ${name}`);
		continue;
	}
	mkdirSync(dirname(dst), { recursive: true });
	cpSync(src, dst, {
		recursive: true,
		dereference: true,
		filter: (s) => {
			if (s.endsWith(sep + ".bin")) return false;
			const rel = relative(src, s);
			if (rel && rel.split(sep).includes("node_modules")) return false;
			return true;
		},
	});
}

console.log(`[vendor] done -> ${vendor}`);
