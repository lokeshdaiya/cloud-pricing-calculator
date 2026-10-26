// Page-level steps of the AWS Pricing Calculator: add a service, save it, open the summary, share, export.
const CALC = "https://calculator.aws/#/";

async function dismissCookies(page) {
	const b = page.locator('button[data-id="awsccc-cb-btn-decline"], button:has-text("Decline")').first();
	if (await b.count().catch(() => 0)) await b.click().catch(() => {});
}

// Opens the "Configure <service>" form from the Add service page.
async function openService(page, name, log) {
	if (!page.url().includes("/addService")) {
		await page.goto(CALC + "addService", { waitUntil: "domcontentloaded", timeout: 90000 });
	}
	await page.waitForSelector('input[type="search"]', { timeout: 60000 });
	await dismissCookies(page);
	await page.waitForTimeout(1500);
	const search = page.locator('main input[type="search"]').first();
	await search.fill("");
	await search.fill(name);
	await page.waitForTimeout(2000);
	const exact = page.locator(`button[aria-label="Configure ${name}"]`);
	if (await exact.count()) { await exact.first().click(); }
	else {
		const offered = await page.$$eval('button[aria-label^="Configure "]', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.getAttribute("aria-label").replace(/^Configure /, "")));
		log(`! service "${name}" not found. Search offered: ${JSON.stringify(offered.slice(0, 10))}`);
		return false;
	}
	await page.waitForURL(/createCalculator/, { timeout: 30000 }).catch(() => {});
	await page.waitForSelector("main button", { state: "attached", timeout: 30000 }).catch(() => log("  (form slow to load: " + page.url() + ")"));
	await page.waitForTimeout(3000);
	return true;
}

// Clicks the visible button with this label (the page often keeps a hidden duplicate for small screens).
async function clickButton(page, text) {
	let b = page.locator(`button[aria-label="${text}"]:visible`).first();
	if (!(await b.count())) b = page.locator("button:visible", { hasText: new RegExp(`^\\s*${text}\\s*$`, "i") }).first();
	if (!(await b.count())) return false;
	await b.click();
	return true;
}

module.exports = { CALC, openService, clickButton, dismissCookies };
