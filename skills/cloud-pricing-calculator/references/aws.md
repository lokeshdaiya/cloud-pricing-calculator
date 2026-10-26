# AWS Pricing Calculator spec

## Contents
1. Spec format
2. How fields are matched
3. Field entry types
4. Known services (tested)
5. Pricing gotchas that change totals

## 1. Spec format

```json
{
  "calculator": "aws",
  "region": "Asia Pacific (Mumbai)",       // default region, exactly as the region dropdown shows it
  "estimates": [
    {
      "name": "MyApp PROD",                 // estimate name; also the output file name
      "region": "Asia Pacific (Mumbai)",    // optional per-estimate override
      "services": [
        {
          "service": "AWS Lambda",          // the service name exactly as the "Add service" search shows it
          "description": "API functions",   // shown on the summary line and in the exports
          "region": "US East (N. Virginia)",// optional per-service override
          "fields": [
            { "radio": "Lambda Function - Without Free Tier" },
            { "label": "Architecture", "option": "Arm" },
            { "label": "Number of requests", "value": 5, "unit": "million per month" },
            { "label": "Duration of each request (in ms)", "value": 300 },
            { "label": "Amount of memory allocated", "value": 1024, "unit": "MB" }
          ]
        }
      ]
    }
  ]
}
```

Each estimate is built in a fresh browser session, saved, renamed, exported and shared. Fields are applied in the
order written; put choices that reveal other fields (a radio for the pricing model, an instance family) first.

## 2. How fields are matched

AWS's forms use hashed CSS class names that change with each release, so fields are matched by the **label a
person sees** next to them (their accessible name). Matching is case-insensitive and accepts a prefix, so
`"Number of requests"` matches "Number of requests Value".

Many forms repeat a label in several sections (Lambda has four "Amount of memory allocated"). The first match is
used unless the entry has `"index": n` (0-based, document order). `aws-discover.js` prints the index of every
repeated label, so copy it from there.

```bash
node scripts/aws-discover.js "Amazon RDS for PostgreSQL" --region "Asia Pacific (Mumbai)" --options
# reveal conditional fields first, then list:
node scripts/aws-discover.js "Amazon EC2" --then '[{"label":"Workloads","option":"Constant usage"}]' --options
```

## 3. Field entry types

| Entry | Use for |
|---|---|
| `{ "label", "value", "unit"?, "index"? }` | number or text box; `unit` sets the unit dropdown right after it (e.g. "million per month", "GB", "TB", "hours") |
| `{ "label", "option", "index"? }` | a dropdown; `option` is the visible text (exact, or a prefix) |
| `{ "radio": "label" }` | radio button by its label |
| `{ "checkbox": "label", "value": true }` | checkbox or toggle |
| `{ "click": "Show Details" }` | a button or collapsed section header, by its text |

## 4. Known services (tested)

Confirmed in October 2026; confirm others with discovery.

| Service name | Notes |
|---|---|
| `AWS Lambda` | fields as in the example above; free tier is on by default, pick "Without Free Tier" for a conservative number |
| `Amazon Simple Storage Service (S3)` | `S3 Standard storage` (+ `unit: "GB per month"`), `PUT, COPY, POST, LIST requests to S3 Standard`, `GET, SELECT, and all other requests from S3 Standard`; other storage classes are checkboxes (`{ "checkbox": "S3 Intelligent - Tiering" }`) that reveal their own fields |

Services with many sections (EC2, RDS, EKS) work the same way but need more entries; run discovery with
`--options` first and expect to use `index` for repeated labels.

## 5. Pricing gotchas that change totals

- **Free tier.** Several services (Lambda, S3 in the first year, CloudWatch) include free-tier allowances by default.
  For a production budget turn them off where the form allows it, or say they are included.
- **Data transfer** is a separate service ("Data Transfer") and is easy to forget; internet egress is often a large
  line for web apps.
- **Units.** Request counts default to "per month" but the dropdown offers "million per month"; a missed unit is a
  1,000,000x error. Always set `unit` on request and storage fields.
- **Savings Plans / Reserved Instances** are chosen inside EC2/RDS forms; state which pricing model the total uses.
