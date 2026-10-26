# Azure Pricing Calculator spec

## Contents
1. Spec format
2. How fields are matched
3. Known products and fields (tested)
4. Pricing gotchas that change totals

## 1. Spec format

```json
{
  "calculator": "azure",
  "region": "central-india",          // default region for every service (calculator region value, not display name)
  "currency": "USD",                  // optional; any currency the calculator's currency dropdown offers (INR, EUR...)
  "estimates": [
    {
      "name": "MyApp PROD",            // estimate name; also the saved-estimate name and the output file name
      "region": "central-india",       // optional per-estimate override
      "services": [
        {
          "slug": "app-service",       // product id: the data-slug of its "Add to estimate" button
          "name": "Web app, P0v3 x 2", // the line's custom name, shown in the estimate and the Excel export
          "region": "sweden-central",  // optional per-service override (e.g. a model only offered in some regions)
          "select": { "type": "linux", "tier": "premiumv3", "size": "p0v3" },  // dropdowns: name -> option value
          "expand": ["Log Data Ingestion"],                                     // collapsed sections to open first
          "fill":   { "instances": 2, "hours": 730 }                            // inputs: name -> value
        }
      ]
    }
  ]
}
```

Order matters inside a service: region, then `select` (in the order written), then `expand`, then `fill`.
Dropdowns change which inputs exist (a tier exposes its own size list), so list the broad choice before the narrow
one: `tier` before `size`, `computeInstanceSeries` before `computeType`.

## 2. How fields are matched

Each field is found by its HTML `name` within that service's block. Option values are the `<option value>`, not
the visible text: `premiumv3`, not "Premium V3". `node scripts/azure-discover.js <slug>` prints every name and
option value; pass `--select '{"tier":"premiumv3"}'` to see fields that only appear after a choice.

Hours: most compute products take `hours` per month; 730 is a full month.

## 3. Known products and fields (tested)

These worked as written in October 2026. Use them as starting points and confirm with discovery if a run warns.

| Product | slug | select | fill |
|---|---|---|---|
| App Service (Linux) | `app-service` | `type: linux`, `tier: basic/standard/premiumv3`, `size: b1/b2/s1/p0v3/p1v3/p1mv3/p2v3` | `instances`, `hours` |
| PostgreSQL Flexible, burstable | `postgresql` | `tier: burstable`, `burstableType: flexible-server-burstable-compute-b1ms` (or `-b2s`) | `singleServers`, `singleHours`, `storageCount` (GiB) |
| PostgreSQL Flexible, general purpose | `postgresql` | `tier: generalpurpose`, `computeInstanceSeries: ddsv5`, `computeType: d2ds v5` | `singleServers` (2 = zone-redundant HA), `singleHours`, `storageCount` |
| Blob storage | `storage` | `type: block-blob`, `performanceTier: standard`, `storageAccountType: general-purpose-v2`, `accessTier: hot`, `redundancy: lrs/zrs/grs` | `count` (GB), `blobWriteOperations`, `blobReadOperations` (in 10k units); `blobDataRetrieval` exists only for some redundancy/tier choices |
| Queue storage | `storage` | `type: queue`, `redundancy` | `count`, `queueClass1Operations`, `queueClass2Operations` |
| Key Vault | `key-vault` | | `operations` (10k units) |
| Defender for Cloud | `defender-for-cloud` | `planType: workloadprotection` | `postgresqlInstances`, `storageUnits`, `malwareScanning` (GB), `keyVaults` |
| Private endpoints | `private-link` | | `privateEndpointUnits`, `privateEndpointHours`, `inboundDataUnits`, `outboundDataUnits` |
| Private DNS | `dns` | `dnsSku: dns`, `type: private` | `privateZones`, `privateQueries` (millions) |
| Application Gateway | `application-gateway` | `tier: wafv2` | `hours`, `computeUnits`, `units` (GB processed) |
| NAT Gateway | `virtual-network-nat` | | `hours`, `dataProcessed` |
| Document Intelligence | `form-recognizer` | `formRecognizerPaymentOption: payg`, `formRecognizerTier: s0` | `formRecognizerPagesPrebuiltTransactions` (1k pages); zero the other `formRecognizer*` page counts |
| Azure OpenAI embeddings | `openai-service` | `selectedModelSeries: embedding-models`, `modelForEmbedding: text-embedding-3-large` | `tokens` (thousands); set `region` to one that offers the model, e.g. `sweden-central` |
| Azure Monitor | `monitor` | | `expand: ["Log Data Ingestion", "Application Insights", "Alert Rules"]`, then `dailyLogsIngested` (GB/day), `logAnalyticsRetention`, `applicationInsightsDailyLogsIngested`, `logAlerts` |
| Container Apps | `container-apps` | | discover first: consumption fields are vCPU-seconds and GiB-seconds |
| Load Testing | `load-testing` | `usageType: loadtestdetails` | `virtualUsersPerTest0`, `testDuration0`, `testRunsPerMonth0` |
| Communication Services email | `communication-services` | | `emailsSentPerMonth`, `emailSize` (MB) |
| API Management v2 | `api-management` | `apiService: api-management-v2`, `tier: basic-v2` | `units`, `hours` |

## 4. Pricing gotchas that change totals

- **Defaults are not zero.** Several products open with a quantity already set (queue operations, container
  registry geo-replicas, 730 hours). Fill every usage field you care about, and zero the ones you don't.
- **Free grants are per subscription, not per line.** Container Apps' monthly free vCPU-seconds and GiB-seconds
  apply once; if Dev/QA/Prod share one subscription, only one of them gets it. The calculator applies the grant to
  every estimate, so totals for shared subscriptions are understated. Say so in the report.
- **Not everything is in the calculator.** Third-party model APIs (Anthropic, OpenAI direct), Marketplace SaaS,
  support plans and reserved-instance discounts negotiated in an EA are not. Report them as separate lines.
- **Region availability.** If a `region` value is not offered for a product the run warns and leaves the default;
  pick a region that offers it (models are the usual case).
