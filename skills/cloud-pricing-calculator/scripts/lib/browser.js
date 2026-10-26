// Finds a Chromium-family browser to drive, so the skill needs only `playwright-core` (no browser download).
// Order: CPC_BROWSER env (path to a chrome/msedge exe) -> a Playwright-downloaded Chromium
// (npx playwright install chromium) -> installed Google Chrome -> installed Microsoft Edge.
// Playwright's own Chromium comes first because it is the build playwright-core is tested against;
// headless Edge has been seen to crash on the AWS calculator's heavier forms.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const os = require("os");

function playwrightChromium() {
	const roots = [
		process.env.PLAYWRIGHT_BROWSERS_PATH,
		process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
		path.join(os.homedir(), ".cache", "ms-playwright"),
		path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
	].filter(Boolean);
	for (const root of roots) {
		if (!fs.existsSync(root)) continue;
		const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
		for (const d of dirs) {
			for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome",
				"chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"]) {
				const p = path.join(root, d, rel);
				if (fs.existsSync(p)) return p;
			}
		}
	}
	return null;
}

// Returns launch options for chromium.launch / launchPersistentContext.
async function browserOptions() {
	if (process.env.CPC_BROWSER) return { executablePath: process.env.CPC_BROWSER };
	const exe = playwrightChromium();
	if (exe) return { executablePath: exe };
	for (const channel of ["chrome", "msedge"]) {
		try { const b = await chromium.launch({ channel, headless: true }); await b.close(); return { channel }; } catch { /* not installed */ }
	}
	throw new Error("No browser found. Install Edge or Chrome, run `npx playwright install chromium`, or set CPC_BROWSER to a chrome/msedge executable.");
}

// Small CLI helpers shared by the scripts.
function parseArgs(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) { out._.push(a); continue; }
		const [k, v] = a.slice(2).split("=");
		if (v !== undefined) out[k] = v;
		else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
		else out[k] = true;
	}
	return out;
}

const money = (t) => { const m = String(t || "").replace(/[,\s]/g, "").match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");

module.exports = { chromium, browserOptions, parseArgs, money, slug };
