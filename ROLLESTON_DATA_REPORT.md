# Rolleston Address Data Report — Historical Extraction Notes + Current Reality

## Why this document was corrected

This repository had a mismatch between documentation and the file that the app actually loads.

### Current checked-in implementation truth

- `app.js` loads `rolleston-addresses.json` and only accepts it when the payload is an **array**.
- The currently checked-in `rolleston-addresses.json` is an **array**.
- The current file contains **16,507 records**.
- Records include a `display` field, which is what the local search path uses first.

That means the earlier version of this report — which described a 47-address `{ metadata, addresses: [] }` envelope — is **historical extraction output**, not an accurate description of the file currently used by the app.

## Current file shape used by the app

```json
[
  {
    "display": "3 Abington Way, Rolleston",
    "housenumber": "3",
    "street": "Abington Way",
    "suburb": "Rolleston",
    "city": "",
    "postcode": "",
    "lat": -43.618767,
    "lon": 172.386035
  }
]
```

## Current checked-in file stats

| Metric | Value |
|-------|-------|
| Payload type | array |
| Record count | 16,507 |
| File size | ~3.0 MB |
| Required-by-code field | `display` |
| Loader entry point | `loadAddressDB()` in `app.js` |

## What the old 47-record report probably was

The earlier content appears to describe a smaller Overpass extraction experiment or an intermediate reporting artifact.
It is still useful as provenance context, but it should not be treated as the active runtime contract for this repository.

## Runtime contract for downstream clients

If another client or migration project consumes this repo as reference, use the following rules:

1. Treat `rolleston-addresses.json` as a plain array.
2. Expect local search to read `display` first.
3. Do not assume the presence of a `metadata` envelope.
4. If you need formal provenance or normalization, add a separate pipeline/output doc instead of redefining the runtime file format in-place.

## Historical note

A previous version of this file claimed:

- 47 unique addresses
- payload shape `{ metadata, addresses: [] }`
- output size ~17 KB

Those statements do **not** describe the current checked-in runtime dataset and were the source of confusion.
