// Lists the fields of one AWS Pricing Calculator service form, so a spec can be written against them.
// Usage: node scripts/aws-discover.js "<service name as shown in the calculator>" [--region "Asia Pacific (Mumbai)"]
//        [--options] [--then '<JSON array of field entries to apply first, e.g. to reveal conditional fields>']
// Prints one line per control: kind, the label to use in the spec, current value, and (with --options) the
// choices each dropdown offers. Labels that repeat on the form need "index" in the spec; it is printed too.
const { chromium, browserOptions, parseArgs } = require("./lib/browser");
const { listControls, cleanLabel, applyField, setRegion } = require("./lib/aws-form");
const { openService } = require("./lib/aws-flow");

(async () => {
	const a = parseArgs(process.argv.slice(2));
	const name = a._[0];
	if (!name) { console.log('Usage: node scripts/aws-discover.js "AWS Lambda" [--region "..."] [--options] [--then \'[...]\']'); process.exit(2); }
	const browser = await chromium.launch({ ...(await browserOptions()), headless: !a.headed });
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
	const log = (m) => console.log(m);
	if (!(await openService(page, name, log))) { await browser.close(); process.exit(1); }
	if (a.region) await setRegion(page, a.region, log);
	for (const f of a.then ? JSON.parse(a.then) : []) await applyField(page, f, log);
	const controls = await page.evaluate(listControls);
	const seen = {};
	console.log(`\n# ${name} - ${controls.length} controls (kind | spec label | index | current value)`);
	for (const c of controls) {
		if (/^(language|open help panel|choose a location type)/i.test(c.label) || /description - optional/i.test(c.label)) continue;
		const label = cleanLabel(c);
		const key = c.kind + "|" + label.toLowerCase();
		const index = (seen[key] = (seen[key] ?? -1) + 1);
		let line = `${c.kind.padEnd(8)} | ${label} | ${index} | ${String(c.value).split("\n")[0]}`;
		if (a.options && (c.kind === "select" || c.kind === "unit")) {
			await page.locator(`[data-cpc="${c.id}"]`).click().catch(() => {});
			await page.waitForTimeout(500);
			const opts = await page.$$eval('[role="option"]', (os) => os.filter((o) => o.offsetParent).map((o) => o.innerText.split("\n")[0].trim()));
			await page.keyboard.press("Escape");
			line += `\n           options: ${JSON.stringify(opts.slice(0, 60))}${opts.length > 60 ? ` (+${opts.length - 60} more)` : ""}`;
		}
		console.log(line);
	}
	await browser.close();
})().catch((e) => { console.error("ERROR " + e.message.split("\n")[0] + "\n" + String(e.stack || "").split("\n").filter((l) => /scripts[\\/]/.test(l)).slice(0, 4).join("\n")); process.exit(1); });
