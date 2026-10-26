// Helpers for the AWS Pricing Calculator (calculator.aws). Its forms are AWS Cloudscape components whose
// CSS classes are hashed and change between releases, so every control is found by its ARIA label instead:
// the same text a screen reader announces, which is also the text a person sees next to the field.

// Runs in the page: lists the visible controls with their accessible labels, in document order.
function listControls() {
	const labelOf = (e) => {
		if (e.getAttribute("aria-label")) return e.getAttribute("aria-label");
		const ids = (e.getAttribute("aria-labelledby") || "").split(" ").filter(Boolean);
		if (ids.length) return ids.map((i) => (document.getElementById(i) || {}).innerText || "").filter(Boolean).join(" / ");
		if (e.id) { const l = document.querySelector(`label[for="${e.id}"]`); if (l) return l.innerText; }
		const l = e.closest("label"); return l ? l.innerText : "";
	};
	const visible = (e) => !!(e.offsetParent || e.getClientRects().length);
	// Tags from an earlier pass can sit on controls that are now hidden; clear them so ids stay unique.
	document.querySelectorAll("[data-cpc]").forEach((e) => e.removeAttribute("data-cpc"));
	let n = 0;
	return [...document.querySelectorAll('main input, main button[aria-haspopup], main [role="switch"], main textarea')]
		.filter((e) => visible(e) || ((e.type === "radio" || e.type === "checkbox") && e.parentElement && visible(e.parentElement)))
		.map((e) => {
			const id = "c" + n++;
			e.setAttribute("data-cpc", id);
			const label = labelOf(e).replace(/\s+/g, " ").trim();
			let kind = e.tagName === "BUTTON" ? "select" : e.type === "radio" ? "radio" : e.type === "checkbox" ? "checkbox" : e.type === "number" ? "number" : "text";
			if (kind === "select" && /(^| \/ )Unit( \/ |$)/.test(label)) kind = "unit";
			const value = kind === "select" || kind === "unit" ? e.innerText.trim() : kind === "radio" || kind === "checkbox" ? e.checked : e.value;
			return { id, kind, label, value };
		});
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
// Field label as people write it: drop the trailing "Value"/"Enter amount" hints and the " / current value" tail.
function cleanLabel(c) {
	let l = c.label;
	if (c.kind === "select") l = l.split(" / ").filter(Boolean).slice(0, -1).join(" / ") || l;
	return l.replace(/ (Value|Enter amount|Enter duration in ms|Enter the amount)$/i, "").replace(/ \/ \/ /g, " / ").trim();
}

function matches(c, label) {
	const a = norm(cleanLabel(c)), b = norm(label);
	return a === b || a.startsWith(b + " ") || a.startsWith(b + " /") || a.startsWith(b);
}

async function pickOption(page, option, log) {
	await page.waitForSelector('[role="option"]', { timeout: 5000 }).catch(() => {});
	const filter = page.locator('[role="dialog"] input[type="search"], [class*="dropdown"] input[type="search"], [role="combobox"][aria-expanded="true"] ~ * input').first();
	if (await filter.count().catch(() => 0)) { await filter.fill(String(option)).catch(() => {}); await page.waitForTimeout(500); }
	const ok = await page.evaluate((want) => {
		const n = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
		const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent && o.getAttribute("aria-disabled") !== "true");
		const first = (o) => n(o.innerText.split("\n")[0]);
		const o = opts.find((o) => first(o) === n(want)) || opts.find((o) => first(o).startsWith(n(want))) || opts.find((o) => n(o.innerText).includes(n(want)));
		if (!o) return opts.slice(0, 25).map((o) => o.innerText.split("\n")[0].trim());
		document.querySelectorAll("[data-cpc-opt]").forEach((x) => x.removeAttribute("data-cpc-opt"));
		o.setAttribute("data-cpc-opt", "1");
		return true;
	}, String(option));
	if (ok !== true) { await page.keyboard.press("Escape"); log(`  ! option "${option}" not found. Offered: ${JSON.stringify(ok)}`); return false; }
	// A real mouse click: Cloudscape ignores a synthetic element.click() on options.
	const opt = page.locator("[data-cpc-opt]").first();
	await opt.scrollIntoViewIfNeeded().catch(() => {});
	await opt.click();
	await page.waitForTimeout(600);
	return true;
}

// Applies one field entry from the spec. Entries:
//   { label, value, unit?, index? }   number/text input (+ its unit dropdown)
//   { label, option, index? }         dropdown
//   { radio }                         radio button by its label
//   { checkbox, value }               checkbox or toggle
//   { click }                         a button or expandable section header by its text (e.g. "Show Details")
async function applyField(page, f, log) {
	if (f.click) {
		const ok = await page.evaluate((t) => {
			const n = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
			const el = [...document.querySelectorAll("main button, main [role=button], main [aria-expanded]")].find((e) => e.offsetParent && n(e.innerText) === n(t));
			if (!el) return false; el.click(); return true;
		}, f.click);
		if (!ok) log(`  ! nothing to click with text "${f.click}"`);
		await page.waitForTimeout(800);
		return;
	}
	const controls = await page.evaluate(listControls);
	if (f.radio || f.checkbox) {
		const want = f.radio || f.checkbox;
		const c = controls.filter((c) => (f.radio ? c.kind === "radio" : c.kind === "checkbox") && matches(c, want))[f.index || 0];
		if (!c) return log(`  ! ${f.radio ? "radio" : "checkbox"} "${want}" not found`);
		const isOn = c.value === true;
		if (f.radio || isOn !== (f.value !== false)) await page.locator(`[data-cpc="${c.id}"]`).evaluate((e) => e.click());
		await page.waitForTimeout(600);
		return;
	}
	if (f.option !== undefined) {
		const c = controls.filter((c) => c.kind === "select" && matches(c, f.label))[f.index || 0];
		if (!c) return log(`  ! dropdown "${f.label}" not found`);
		if (norm(c.value.split("\n")[0]) === norm(f.option)) return;
		await page.locator(`[data-cpc="${c.id}"]`).click();
		await pickOption(page, f.option, log);
		return;
	}
	const inputs = controls.filter((c) => (c.kind === "number" || c.kind === "text") && matches(c, f.label));
	const c = inputs[f.index || 0];
	if (!c) return log(`  ! field "${f.label}"${f.index ? ` #${f.index}` : ""} not found`);
	const box = page.locator(`[data-cpc="${c.id}"]`);
	await box.fill(String(f.value));
	await box.press("Tab");
	await page.waitForTimeout(300);
	if (f.unit !== undefined) {
		// The unit dropdown is the first "Unit" control after this input.
		const after = controls.slice(controls.indexOf(c) + 1).find((x) => x.kind === "unit" || x.kind === "select");
		if (!after || after.kind !== "unit") return log(`  ! "${f.label}" has no unit dropdown`);
		if (norm(after.value) === norm(f.unit)) return;
		await page.locator(`[data-cpc="${after.id}"]`).click();
		await pickOption(page, f.unit, log);
	}
}

async function setRegion(page, region, log) {
	const c = (await page.evaluate(listControls)).find((c) => c.kind === "select" && /choose a region/i.test(c.label));
	if (!c) return log("  ! region dropdown not found");
	if (norm(c.value) === norm(region)) return;
	await page.locator(`[data-cpc="${c.id}"]`).click();
	await pickOption(page, region, log);
}

module.exports = { listControls, cleanLabel, applyField, setRegion, pickOption };
