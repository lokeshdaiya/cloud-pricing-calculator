// Builds estimates in the official AWS Pricing Calculator (calculator.aws) from a JSON spec, then
// saves a public share link, the calculator's own export files, a screenshot and a results JSON.
// No sign-in is needed: AWS share links are public and are created by the calculator itself.
// Usage: node scripts/aws-build.js <spec.json> [--out <dir>] [--only <estimate name>] [--headed] [--no-share]
// Spec format: see references/aws.md and examples/aws-*.json.
const fs = require("fs");
const path = require("path");
const { chromium, browserOptions, parseArgs, money, slug } = require("./lib/browser");
const { applyField, setRegion } = require("./lib/aws-form");
const { openService, clickButton, CALC } = require("./lib/aws-flow");

const a = parseArgs(process.argv.slice(2));
if (!a._[0]) { console.log("Usage: node scripts/aws-build.js <spec.json> [--out dir] [--only name] [--headed] [--no-share]"); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(a._[0], "utf8"));
const OUT = path.resolve(a.out || path.join(path.dirname(path.resolve(a._[0])), "out-aws"));
const estimates = (spec.estimates || [spec]).filter((e) => !a.only || e.name === a.only);

// The service form's "Description - optional" box; the text shows in the summary and the exports.
async function setDescription(page, text) {
	const box = page.locator('main input[aria-label^="Description"]:visible').first();
	if (await box.count()) await box.fill(String(text).slice(0, 200));
}

// The estimate name is edited in place: "Edit" turns the heading into a text box with Save / Cancel.
async function renameEstimate(page, name, log) {
	const edit = page.locator('a[data-cy="edit-estimate-name"]:visible, a[aria-label^="Edit My Estimate"]:visible').first();
	if (!(await edit.count())) return log("  ! could not rename the estimate (no Edit link)");
	await edit.click();
	await page.waitForTimeout(800);
	const inp = page.locator('main input[aria-label="Enter Name"]:visible').first();
	if (!(await inp.count())) return log("  ! the estimate name box did not open");
	await inp.fill(name);
	if (!(await clickButton(page, "Save"))) await inp.press("Enter");
	await page.waitForTimeout(1000);
}

async function readSummary(page) {
	return page.evaluate(() => {
		const txt = (e) => (e ? e.innerText.replace(/\s+/g, " ").trim() : "");
		const head = document.querySelector("main").innerText;
		const pick = (re) => (head.match(re) || [])[1] || "";
		const rows = [...document.querySelectorAll("main table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map(txt));
		return {
			upfront: pick(/Upfront cost\s*\n\s*([^\n]+)/i),
			monthly: pick(/Monthly cost\s*\n\s*([^\n]+)/i),
			yearly: pick(/Total 12 months cost\s*\n\s*([^\n]+)/i),
			// columns: [select, Service Name, Status, Upfront cost, Monthly cost, Description, Region, Config Summary]
			rows: rows.filter((r) => r.length >= 7).map((r) => ({ service: r[1], upfront: r[3], monthly: r[4], description: r[5], region: r[6], config: r[7] || "" })),
		};
	});
}

async function shareLink(page, log) {
	if (!(await clickButton(page, "Share"))) { log("  ! Share button not found"); return ""; }
	await page.waitForTimeout(1500);
	await clickButton(page, "Agree and continue").catch(() => {});
	for (let i = 0; i < 20; i++) {
		await page.waitForTimeout(1000);
		const link = await page.evaluate(() => {
			for (const e of document.querySelectorAll("input, textarea")) if (/^https:\/\/calculator\.aws\/#\/estimate\?id=/.test(e.value)) return e.value;
			const m = document.body.innerText.match(/https:\/\/calculator\.aws\/#\/estimate\?id=[0-9a-f]+/i);
			return m ? m[0] : "";
		});
		if (link) { await page.keyboard.press("Escape").catch(() => {}); return link; }
	}
	log("  ! share dialog opened but no link appeared");
	return "";
}

// The Export menu offers several formats; save each one it offers.
async function exportFiles(page, base, log) {
	const saved = [];
	for (const fmt of ["CSV", "PDF", "JSON"]) {
		if (!(await clickButton(page, "Export"))) { log("  ! Export button not found"); break; }
		await page.waitForTimeout(800);
		const item = page.locator('[role="menuitem"]:visible', { hasText: new RegExp(fmt, "i") }).first();
		if (!(await item.count())) { await page.keyboard.press("Escape"); continue; }
		try {
			const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), (async () => {
				await item.click();
				await page.waitForTimeout(1000);
				// Some formats ask for confirmation first.
				for (const t of ["Export", "Download", "OK", "Agree and continue"]) {
					const b = page.locator('[role="dialog"] button:visible', { hasText: new RegExp(`^\\s*${t}\\s*$`, "i") }).first();
					if (await b.count()) { await b.click(); break; }
				}
			})()]);
			const file = `${base}.${(dl.suggestedFilename().split(".").pop() || fmt).toLowerCase()}`;
			await dl.saveAs(file);
			saved.push(file);
		} catch (e) { log(`  ! ${fmt} export failed: ${e.message.split("\n")[0]}`); await page.keyboard.press("Escape").catch(() => {}); }
	}
	return saved;
}

async function buildEstimate(browser, est) {
	const warnings = [];
	const log = (m) => { console.log(m); if (m.includes("!")) warnings.push(m.trim()); };
	log(`== ${est.name} ==`);
	const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, locale: "en-US" });
	const page = await ctx.newPage();
	await page.goto(CALC + "addService", { waitUntil: "domcontentloaded", timeout: 90000 });
	const services = est.services || [];
	for (const [i, svc] of services.entries()) {
		log(`+ ${svc.service}${svc.description ? " - " + svc.description : ""}`);
		if (!(await openService(page, svc.service, log))) continue;
		if (svc.description) await setDescription(page, svc.description);
		const region = svc.region || est.region || spec.region;
		if (region) await setRegion(page, region, log);
		for (const f of svc.fields || []) await applyField(page, f, log);
		const last = i === services.length - 1;
		if (!(await clickButton(page, last ? "Save and view summary" : "Save and add service"))) log("  ! save button not found");
		await page.waitForTimeout(3000);
	}
	if (!page.url().includes("/estimate")) { await clickButton(page, "View summary"); await page.waitForTimeout(3000); }
	await page.waitForSelector("main table", { timeout: 30000 }).catch(() => {});
	await renameEstimate(page, est.name, log);
	const summary = await readSummary(page);
	fs.mkdirSync(OUT, { recursive: true });
	const base = path.join(OUT, `AWS_${slug(est.name)}`);
	await page.screenshot({ path: base + ".png", fullPage: true });
	const files = await exportFiles(page, base, log);
	const link = a["no-share"] ? "" : await shareLink(page, log);
	log(`Monthly ${summary.monthly} | 12 months ${summary.yearly}${link ? "\nShare link: " + link : ""}`);
	await ctx.close();
	return { name: est.name, monthly: money(summary.monthly), monthlyText: summary.monthly, yearlyText: summary.yearly, upfrontText: summary.upfront, lines: summary.rows, link, files, warnings };
}

(async () => {
	const browser = await chromium.launch({ ...(await browserOptions()), headless: !a.headed, slowMo: a.headed ? 30 : 0 });
	const results = [];
	for (const est of estimates) results.push(await buildEstimate(browser, est));
	await browser.close();
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(path.join(OUT, "aws-results.json"), JSON.stringify({ calculator: "aws", builtAt: new Date().toISOString(), results }, null, 2));
	fs.writeFileSync(path.join(OUT, "aws-links.txt"), results.map((r) => `${r.name}  ${r.monthlyText}/month  ${r.link || "(no link)"}`).join("\n") + "\n");
	console.log(`\nResults: ${path.join(OUT, "aws-results.json")}`);
	if (results.some((r) => r.warnings.length)) { console.log("Some steps reported warnings - see the lines starting with '!' above."); process.exitCode = 3; }
})().catch((e) => { console.error("ERROR " + e.message.split("\n")[0] + "\n" + String(e.stack || "").split("\n").filter((l) => /scripts[\\/]/.test(l)).slice(0, 4).join("\n")); process.exit(1); });
