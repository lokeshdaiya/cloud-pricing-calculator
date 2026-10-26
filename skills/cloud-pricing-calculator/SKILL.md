---
name: cloud-pricing-calculator
description: Builds real cost estimates on the official Azure Pricing Calculator (azure.microsoft.com/pricing/calculator) and AWS Pricing Calculator (calculator.aws) by driving them with Playwright from a JSON spec, then returns the calculator's own share links, Excel/CSV/JSON exports, per-service monthly costs and screenshots. Use this whenever someone wants an Azure or AWS estimate, a cloud cost breakdown, a pricing-calculator link to share with a client or manager, Dev/QA/Prod environment costing, or wants to turn an architecture or service list into numbers from Microsoft's or Amazon's own calculator, even if they just say "how much will this cost on Azure" or "make me a calculator link".
compatibility: Node.js 18+, the playwright-core npm package, and a Chromium-family browser (Playwright Chromium, Chrome or Edge). Internet access to the calculator sites. Azure share/save needs the user to sign in with a Microsoft account once.
---

# Cloud pricing calculator (Azure and AWS)

This skill produces estimates **inside the vendors' own calculators**, so the numbers, the share link and the
export are the ones a client, finance team or Microsoft/AWS account manager already trusts. Prices come from the
calculator at run time; nothing here hard-codes a rate.

The work splits cleanly: you (Claude) decide *what* goes in the estimate and write it as a JSON spec; the scripts
in `scripts/` do the clicking. Everything the scripts need to find a field is in the spec, so a failed field is a
spec problem you can fix by looking at what the discovery script prints, not a code problem.

## Setup (once per machine)

```bash
cd <this skill folder (the folder holding this SKILL.md)>
npm install            # installs playwright-core only (no browser download)
```

The scripts look for a browser in this order: `CPC_BROWSER` (path to a chrome/msedge executable), a Playwright
Chromium (`npx playwright install chromium`), installed Chrome, installed Edge. If none is found the error says so.
Prefer Playwright's Chromium when it is available: headless Edge has crashed on AWS's heavier forms.

## Workflow

1. **Pin down the workload.** List the services per environment with sizes and usage (instances, hours, GB stored,
   requests, tokens). Ask about anything that moves the total materially: region, environment count, high
   availability, retention. Write down the assumptions; they go in the final answer.
2. **Find the exact field names** with the discovery script for the cloud in question. Do this for every product
   you have not used before in this session. Guessing names is the most common cause of a silently wrong estimate,
   because the calculator keeps its default for any field it cannot find.
   - Azure: `node scripts/azure-discover.js --search "postgres"` then `node scripts/azure-discover.js postgresql`
   - AWS: `node scripts/aws-discover.js "Amazon RDS for PostgreSQL" --options`
3. **Write the spec** (one file can hold several estimates, e.g. DEV, QA and PROD). Formats and worked examples:
   - Azure → read `references/azure.md`; example `examples/azure-web-app.json`
   - AWS → read `references/aws.md`; example `examples/aws-serverless-web-app.json`
4. **Run the build** and keep the console output:
   - Azure: `node scripts/azure-build.js spec.json --out <dir>` (add `--share` for a link, `--save` to also save
     in the user's account; both open a browser for a one-time Microsoft sign-in, see below)
   - AWS: `node scripts/aws-build.js spec.json --out <dir>` (share link included; no sign-in)
5. **Check before reporting.** Every line starting with `!` is a field that was not set. Exit code 3 means at least
   one exists. Fix the spec (the message lists the options actually offered) and rerun, rather than reporting a
   total that silently used a default. Also sanity-check each line's monthly cost in the results JSON against what
   you expect: a $0 line usually means a usage field was missed; a surprisingly large one usually means a default
   quantity (often 730 hours or 1 TB) was left in place.
6. **Report**: total per estimate, per-line costs, the share links, where the exports are, and the assumptions.
   Mention anything the calculator cannot price (third-party APIs, licences, support plans, people) as a separate
   line rather than leaving it out.

## Sign-in for Azure share links and saving

Azure only enables **Share** and **Save** for a signed-in Microsoft account. With `--share` or `--save` the script
opens a visible browser, waits up to 10 minutes for the user to click "Log in" and finish signing in, then carries
on by itself. The session is stored in `~/.cloud-pricing-calculator/azure-profile` (override with `--profile`), so
later runs skip the prompt. Tell the user this is about to happen before you run it; never type their credentials.

Two Azure behaviours worth knowing:
- A share link is a **snapshot**. Editing the estimate later does not change the link; rebuild and share again.
- The calculator limits how many estimates are open at once ("Too many estimates open"). If saving fails with that,
  ask the user to close extra estimate tabs in the calculator, then rerun with `--save`.

AWS links need no account: anyone with the link sees the estimate, and the link is permanent.

## Outputs

Both builders write to `--out` (default: `out-azure/` or `out-aws/` next to the spec):

| File | Content |
|---|---|
| `azure-results.json` / `aws-results.json` | per estimate: total, every line with its monthly cost, link, warnings |
| `azure-links.txt` / `aws-links.txt` | one line per estimate: name, monthly total, share link |
| `Azure_<name>.xlsx` | the Azure calculator's own Excel export |
| `AWS_<name>.csv/.json/.pdf` | whichever exports the AWS calculator offers |
| `*.png` | a screenshot of each finished estimate |

If the user wants everything in one workbook, build it from the results JSON (it already has every line), and
keep the vendor exports as the source of truth.

## When something breaks

The calculators are live websites and change. The scripts locate things the way a person would (Azure: the
`name` attribute of each field; AWS: each field's visible label), which survives most redesigns, but if a run
fails:
1. Run the discovery script for the failing product; it shows the current names/labels and options.
2. Rerun with `--headed` to watch the browser.
3. If a whole step fails (no export, no share link), the selectors for that step are in one function in
   `scripts/azure-build.js` or `scripts/lib/aws-flow.js`; fix it there.
