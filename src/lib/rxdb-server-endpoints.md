# RxDB Replication – Required Server Endpoints

RxDB's HTTP replication handler (used in `syncEngine.ts`) requires three
additional query parameters on the existing GET endpoints and a bulk-PUT
variant.  No new routes are needed beyond what is already in `api.ts`.

---

## basedeals  (`/deals`)

### GET /deals?since=<ISO>&limit=<n>
Return documents with `updatedAt > since`, ordered by `updatedAt ASC`,
capped at `limit`.  Include soft-deleted docs with `_deleted: true`.

```json
[
  { "id": "…", "updatedAt": "2025-01-01T00:00:00.000Z", "customer": "…", … },
  { "id": "…", "_deleted": true, "updatedAt": "2025-01-02T00:00:00.000Z" }
]
```

### PUT /deals  (bulk upsert)
Accept an array of BaseDeal objects.  Upsert each by `id`.
Honour `_deleted: true` as a soft-delete flag.

```json
[{ "id": "…", "customer": "…", … }]
```

---

## months  (`/months`)

### GET /months?since=<ISO>&limit=<n>
Same pattern as deals but for MonthMeta documents.

### PUT /months  (bulk upsert – NEW)
Previously only `POST /months/next` existed.  Add a bulk PUT that accepts
an array of MonthMeta objects for RxDB push to work.

---

## month-records  (`/month-records`)

### GET /month-records?since=<ISO>&limit=<n>
Return MonthRecord documents updated after `since`.

### PUT /month-records  (already exists – ensure array support)
Already exists for bulk save; just ensure it accepts the full array format.

---

## meta  (`/meta/activeMonthId`, `/meta/formulas`)

No changes needed – the meta replication handler calls each key's existing
GET/PUT endpoint individually.

---

## MongoDB indexes to add

```js
// speed up the `since` pull queries
db.collection("deals").createIndex({ updatedAt: 1 });
db.collection("months").createIndex({ updatedAt: 1 });
db.collection("month-records").createIndex({ updatedAt: 1 });
```
