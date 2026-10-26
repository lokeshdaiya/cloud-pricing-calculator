// Builds estimates in the official Azure Pricing Calculator from a JSON spec, exports each one to the
// calculator's own Excel file, and (when signed in) creates a share link and saves it to the account.
// Usage: node scripts/azure-build.js <spec.json> [--out <dir>] [--only <estimate name>] [--headed]
//        [--share] [--save] [--currency INR] [--profile <dir>] [--keep-open]
// --share / --save need a Microsoft account sign-in: a browser window opens and the script waits for it.
// The sign-in is kept in --profile (default ~/.cloud-pricing-calculator/azure-profile) for later runs.
// Spec format: see references/azure.md and examples/azure-*.json.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium, browserOptions, parseArgs, money, slug } = require("./lib/browser");

const a = parseArgs(process.argv.slice(2));
if (!a._[0]) { console.log("Usage: node scripts/azure-build.js <spec.json> [--out dir] [--only name] [--headed] [--share] [--save] [--currency INR]"); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(a._[0], "utf8"));
const OUT = path.resolve(a.out || path.join(path.dirname(path.resolve(a._[0])), "out-azure"));
const estimates = (spec.estimates || [spec]).filter((e) => !a.only || e.name === a.only);
const CURRENCY = a.currency || spec.currency || "USD";
const URL = `https://azure.microsoft.com/${spec.locale || "en-us"}/pricing/calculator/`;
const SIGN_IN = !!(a.share || a.save);
const PROFILE = path.resolve(a.profile || path.join(os.homedir(), ".cloud-pricing-calculator", "azure-profile"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setSelect(mod, name, value, log) {
	const sel = mod.locator(`select[name="${name}"]:visible`).first();
	if (!(await sel.count())) return log(`  ! dropdown "${name}" not found`);
	const ok = await sel.evaluate((s, v) => [...s.options].some((o) => o.value === v), String(value));
	if (!ok) {
		const offered = await sel.evaluate((s) => [...s.options].map((o) => o.value).slice(0, 30));
		return log(`  ! ${name}: option "${value}" not offered (left at "${await sel.inputValue()}"). Offered: ${JSON.stringify(offered)}`);
	}
	await sel.selectOption(String(value));
	await mod.page().waitForTimeout(700);
}

async function setInput(mod, name, value, log) {
	const inp = mod.locator(`input[name="${name}"]:visible`).first();
	if (!(await inp.count())) return log(`  ! field "${name}" not found`);
	await inp.fill(String(value));
	await inp.press("Tab");
	await mod.page().waitForTimeout(250);
}

// Adds one product and configures it. Each new service block gets a unique data-cpc tag, because the
// calculator re-renders blocks and positional lookups ("the last one") drift.
let added = 0;
async function addService(page, svc, est, log, retry) {
	const fresh = page.locator(".wa-calcService:not([data-seen])").first();
	// On a retry, the block from the first attempt may have appeared late; use it instead of adding a duplicate.
	if (!retry || !(await fresh.count())) {
		await page.$$eval(".wa-calcService", (els) => els.forEach((e) => e.setAttribute("data-seen", "1")));
		const found = await page.$eval(`button[data-slug="${svc.slug}"]`, (e) => { e.click(); return true; }).catch(() => false);
		if (!found) return log(`  ! product "${svc.slug}" not in the calculator - skipped (${svc.name || ""})`);
	}
	const tag = String(++added);
	// Big products (Azure Monitor) render slowly once the estimate already holds several services.
	await fresh.waitFor({ timeout: 60000 });
	await fresh.evaluate((e, t) => { e.setAttribute("data-seen", "1"); e.setAttribute("data-cpc", t); }, tag);
	const mod = page.locator(`.wa-calcService[data-cpc="${tag}"]`);
	if (svc.name) await setInput(mod, "displayName", svc.name, log);
	const region = svc.region || est.region || spec.region;
	if (region && (await mod.locator('select[name="region"]').count())) await setSelect(mod, "region", region, log);
	for (const [k, v] of Object.entries(svc.select || {})) await setSelect(mod, k, v, log);
	for (const t of svc.expand || []) {
		const b = mod.locator("button.toggle-submodule-btn", { hasText: t }).first();
		if (!(await b.count())) { log(`  ! section "${t}" not found`); continue; }
		if ((await b.getAttribute("aria-expanded")) !== "true") { await b.click(); await page.waitForTimeout(600); }
	}
	for (const [k, v] of Object.entries(svc.fill || {})) await setInput(mod, k, v, log);
	await page.waitForTimeout(500);
	const monthly = await mod.evaluate((m) => {
		const t = m.innerText.match(/Monthly cost\s*\n?\s*([^\n]+)/i) || m.innerText.match(/Monthly:\s*([^\n]+)/i);
		return t ? t[1] : "";
	});
	return { name: svc.name || svc.slug, slug: svc.slug, monthly: money(monthly), monthlyText: monthly };
}

async function openCalculator(page) {
	await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
	await page.waitForSelector("button[data-slug]", { state: "attached", timeout: 60000 });
	await page.waitForTimeout(3000);
}

// Share and Save stay disabled until the user signs in with a Microsoft account (and on an empty estimate).
async function waitForSignIn(page) {
	const signedIn = () => page.$eval("#share-estimate", (e) => !e.disabled).catch(() => false);
	const addOne = () => page.$eval('button[data-slug="key-vault"]', (e) => e.click()).catch(() => {});
	await addOne();
	await page.waitForTimeout(3000);
	if (await signedIn()) return true;
	console.log("\n>>> Sign in with your Microsoft account in the browser window ('Log in' at the top right).");
	console.log(">>> The script carries on by itself once you are signed in (waits up to 10 minutes).\n");
	for (let i = 0; i < 120; i++) {
		await sleep(5000);
		if (!page.url().includes("/pricing/calculator")) continue; // still on the Microsoft sign-in pages
		if (!(await page.$(".wa-calcService"))) { await addOne(); await page.waitForTimeout(2000); }
		if (await signedIn()) { console.log("Signed in."); return true; }
	}
	return false;
}

async function deleteAll(page) {
	for (let i = 0; i < 80; i++) {
		if (!(await page.locator(".wa-calcService").count())) return;
		const ok = await page.$eval(".wa-calcService button.delete, button.calculator-button.delete", (e) => { e.click(); return true; }).catch(() => false);
		if (!ok) return;
		await page.waitForTimeout(700);
	}
}

async function shareLink(page, log) {
	const btn = page.locator("#share-estimate");
	if (await btn.isDisabled()) { log("  ! Share is disabled (not signed in)"); return ""; }
	await btn.click();
	const re = /https:\/\/[^\s"'<>]*azure\.com\/[^\s"'<>]*/i;
	for (let i = 0; i < 30; i++) {
		await page.waitForTimeout(1000);
		const found = await page.evaluate((src) => {
			const re = new RegExp(src, "i");
			for (const e of document.querySelectorAll("input, textarea")) if (e.offsetParent && re.test(e.value) && !/\/pricing\/calculator\/?$/.test(e.value)) return e.value.match(re)[0];
			for (const e of document.querySelectorAll('[role="dialog"], .modal, [class*="share" i]')) { const m = e.innerText && e.innerText.match(re); if (m) return m[0]; }
			return "";
		}, re.source);
		if (found) { await page.keyboard.press("Escape").catch(() => {}); return found; }
	}
	log("  ! Share dialog opened but no link was found - copy it from the browser window");
	return "";
}

async function closeDialogs(page) {
	for (let i = 0; i < 4; i++) {
		const clicked = await page.evaluate(() => {
			const d = [...document.querySelectorAll('[role="dialog"], .modal-background.active')].find((e) => e.offsetParent);
			if (!d) return false;
			const b = [...d.querySelectorAll("button")].find((x) => x.offsetParent && /^(ok|done|close|got it|continue)$/i.test(x.innerText.trim()));
			if (b) b.click();
			return !!b;
		});
		if (!clicked) return;
		await page.waitForTimeout(800);
	}
}

// Saves the open estimate to "Saved estimates" in the signed-in account.
async function saveToAccount(page, name, log) {
	await closeDialogs(page);
	const btn = page.locator('button[aria-label="Save estimate"]').first();
	if (!(await btn.count()) || (await btn.isDisabled())) { log("  ! Save is disabled (not signed in)"); return false; }
	await btn.evaluate((e) => e.click());
	await page.waitForTimeout(2500);
	await page.evaluate((nm) => {
		const d = [...document.querySelectorAll('[role="dialog"]')].find((e) => e.offsetParent);
		if (!d) return;
		const inp = [...d.querySelectorAll("input[type=text]")].find((e) => e.offsetParent);
		if (inp) { inp.value = nm; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); }
		const b = [...d.querySelectorAll("button")].find((x) => x.offsetParent && /^save$/i.test(x.innerText.trim()));
		if (b) b.click();
	}, name);
	await page.waitForTimeout(4000);
	const ok = await page.locator("body").evaluate((b) => /estimate has been saved/i.test(b.innerText));
	await closeDialogs(page);
	if (!ok) log("  ! no 'estimate has been saved' confirmation seen - check Saved estimates in the calculator");
	return ok;
}

async function buildEstimate(page, est) {
	const warnings = [];
	const log = (m) => { console.log(m); if (m.includes("!")) warnings.push(m.trim()); };
	log(`== ${est.name} ==`);
	await deleteAll(page);
	const nameBox = page.locator('input[name="estimate-name"]').first();
	if (await nameBox.count()) { await nameBox.fill(est.name).catch(() => {}); await nameBox.press("Tab").catch(() => {}); }
	if (CURRENCY !== "USD") {
		const cur = page.locator('select[name="currentCurrency"]').first();
		if (await cur.count()) { await cur.selectOption(CURRENCY).catch(() => log(`  ! currency ${CURRENCY} not offered`)); await page.waitForTimeout(3000); }
	}
	const lines = [];
	for (const svc of est.services || []) {
		log(`+ ${svc.name || svc.slug}`);
		for (let attempt = 1; attempt <= 2; attempt++) {
			try { const r = await addService(page, svc, est, log, attempt > 1); if (r) lines.push(r); break; }
			catch (e) { log(`  ! ${svc.name || svc.slug} (attempt ${attempt}): ${e.message.split("\n")[0]}`); await page.waitForTimeout(3000); }
		}
	}
	await page.waitForTimeout(1500);
	const headerTotal = await page.locator("body").evaluate((b) => (b.innerText.match(/([^\s\n]+)\s*\/\s*Estimated monthly cost/i) || b.innerText.match(/Estimated monthly cost\s*\n?\s*([^\n]+)/i) || [])[1] || "");
	const total = money(headerTotal) ?? +lines.reduce((s, l) => s + (l.monthly || 0), 0).toFixed(2);
	fs.mkdirSync(OUT, { recursive: true });
	const base = path.join(OUT, `Azure_${slug(est.name)}`);
	await page.screenshot({ path: base + ".png" });
	let xlsx = "";
	try {
		const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.locator("button.export-button").first().click()]);
		xlsx = base + ".xlsx";
		await dl.saveAs(xlsx);
	} catch (e) { log(`  ! Excel export failed: ${e.message.split("\n")[0]}`); }
	const link = a.share || a.save ? await shareLink(page, log) : "";
	const saved = a.save ? await saveToAccount(page, est.name, log) : false;
	log(`Monthly ${CURRENCY} ${total}${xlsx ? "  -> " + xlsx : ""}${link ? "\nShare link: " + link : ""}${a.save ? "\nSaved to account: " + saved : ""}`);
	return { name: est.name, currency: CURRENCY, monthly: total, lines, xlsx, link, saved, warnings };
}

(async () => {
	const launch = { ...(await browserOptions()), acceptDownloads: true, viewport: { width: 1400, height: 1000 }, locale: "en-US" };
	let ctx, browser;
	if (SIGN_IN) {
		fs.mkdirSync(PROFILE, { recursive: true });
		ctx = await chromium.launchPersistentContext(PROFILE, { ...launch, headless: false });
	} else {
		browser = await chromium.launch({ ...launch, headless: !a.headed, slowMo: a.headed ? 40 : 0 });
		ctx = await browser.newContext(launch);
	}
	const page = ctx.pages()[0] || (await ctx.newPage());
	await openCalculator(page);
	if (SIGN_IN && !(await waitForSignIn(page))) { console.log("Not signed in after 10 minutes - stopping."); await ctx.close(); process.exit(2); }
	const results = [];
	for (const est of estimates) results.push(await buildEstimate(page, est));
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(path.join(OUT, "azure-results.json"), JSON.stringify({ calculator: "azure", builtAt: new Date().toISOString(), results }, null, 2));
	fs.writeFileSync(path.join(OUT, "azure-links.txt"), results.map((r) => `${r.name}  ${r.currency} ${r.monthly}/month  ${r.link || "(no link - run with --share)"}`).join("\n") + "\n");
	console.log(`\nResults: ${path.join(OUT, "azure-results.json")}`);
	if (results.some((r) => r.warnings.length)) { console.log("Some steps reported warnings - see the lines starting with '!' above."); process.exitCode = 3; }
	if (a["keep-open"]) { console.log("Browser left open - close the window when done."); await new Promise((r) => ctx.on("close", r)); }
	else { await ctx.close(); if (browser) await browser.close(); }
})().catch((e) => { console.error("ERROR " + e.message.split("\n")[0] + "\n" + String(e.stack || "").split("\n").filter((l) => /scripts[\\/]/.test(l)).slice(0, 4).join("\n")); process.exit(1); });
