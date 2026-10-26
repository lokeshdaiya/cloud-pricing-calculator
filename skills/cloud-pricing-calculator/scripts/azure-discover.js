// Lists products and their fields in the Azure Pricing Calculator, so a spec can be written against them.
// Usage:
//   node scripts/azure-discover.js --search "app service"          find products and their slugs
//   node scripts/azure-discover.js app-service [postgresql ...]    list each product's dropdowns and inputs
//        [--select '{"tier":"premiumv3"}']                         set dropdowns first (they reveal other fields)
// Dropdowns go in a spec's "select" (by name, value = option value), inputs in "fill" (by name).
const { chromium, browserOptions, parseArgs } = require("./lib/browser");

const a = parseArgs(process.argv.slice(2));
const URL = "https://azure.microsoft.com/en-us/pricing/calculator/";

(async () => {
	if (!a.search && !a._.length) { console.log('Usage: node scripts/azure-discover.js --search "<text>" | <slug> [slug ...] [--select \'{"name":"value"}\']'); process.exit(2); }
	const browser = await chromium.launch({ ...(await browserOptions()), headless: !a.headed });
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
	await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
	await page.waitForSelector("button[data-slug]", { state: "attached", timeout: 60000 });
	await page.waitForTimeout(2000);

	if (a.search) {
		const q = String(a.search).toLowerCase();
		const hits = await page.$$eval("button[data-slug]", (bs) => {
			const seen = new Set();
			return bs.map((b) => {
				const card = b.closest("[class*='product'], li, div");
				const title = (b.getAttribute("data-title") || b.getAttribute("aria-label") || (card && card.innerText.split("\n")[0]) || "").trim();
				return { slug: b.getAttribute("data-slug"), title };
			}).filter((x) => !seen.has(x.slug) && seen.add(x.slug));
		});
		const found = hits.filter((h) => (h.slug + " " + h.title).toLowerCase().includes(q));
		console.log(found.length ? found.map((h) => `${h.slug.padEnd(40)} ${h.title}`).join("\n") : `No product matched "${a.search}". ${hits.length} products are listed; try a shorter word.`);
		await browser.close();
		return;
	}

	const presets = a.select ? JSON.parse(a.select) : {};
	for (const s of a._) {
		const ok = await page.$eval(`button[data-slug="${s}"]`, (e) => { e.click(); return true; }).catch(() => false);
		if (!ok) { console.log(`\n# ${s}: not a product slug - use --search to find it`); continue; }
		await page.waitForTimeout(3500);
		const mod = page.locator(".wa-calcService").last();
		for (const [k, v] of Object.entries(presets)) {
			const sel = mod.locator(`select[name="${k}"]:visible`).first();
			if (await sel.count()) { await sel.selectOption(String(v)).catch(() => console.log(`  ! ${k}=${v} not offered`)); await page.waitForTimeout(800); }
		}
		const fields = await mod.evaluate((m) => {
			const labelOf = (e) => {
				const l = e.id && document.querySelector(`label[for="${e.id}"]`);
				return (l ? l.innerText : e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
			};
			const sections = [...m.querySelectorAll("button.toggle-submodule-btn")].map((b) => `${b.innerText.trim()} (${b.getAttribute("aria-expanded") === "true" ? "open" : "collapsed"})`);
			const ctrls = [...m.querySelectorAll("select, input")].filter((e) => e.name && e.type !== "hidden" && e.offsetParent && e.name !== "displayName")
				.map((e) => e.tagName === "SELECT"
					? `select  ${e.name.padEnd(34)} = ${e.value.padEnd(24)} ${labelOf(e)}\n          options: ${[...e.options].map((o) => o.value).join(", ").slice(0, 900)}`
					: `fill    ${e.name.padEnd(34)} = ${String(e.value).padEnd(24)} ${labelOf(e)}`);
			const total = (m.innerText.match(/Monthly cost\s*\n?\s*([^\n]+)/i) || [])[1] || "";
			return { sections, ctrls, total };
		});
		console.log(`\n# ${s}  (monthly at defaults: ${fields.total})`);
		if (fields.sections.length) console.log(`expandable sections (spec "expand"): ${fields.sections.join(" | ")}`);
		console.log(fields.ctrls.join("\n"));
	}
	await browser.close();
})().catch((e) => { console.error("ERROR " + e.message.split("\n")[0] + "\n" + String(e.stack || "").split("\n").filter((l) => /scripts[\\/]/.test(l)).slice(0, 4).join("\n")); process.exit(1); });
