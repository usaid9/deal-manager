import { Router } from "express";
import { BaseDeal, MonthMeta, MonthRecord, Meta } from "./models.js";

const r = Router();

// ── Base Deals ────────────────────────────────────────────────
r.get("/deals", async (req, res) => {
  try {
    const docs = await BaseDeal.find({}, { _id: 0 });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put("/deals", async (req, res) => {
  // bulk upsert array
  try {
    const deals = req.body;
    await Promise.all(
      deals.map((d) =>
        BaseDeal.findOneAndUpdate({ id: d.id }, d, { upsert: true, new: true })
      )
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put("/deals/:id", async (req, res) => {
  try {
    await BaseDeal.findOneAndUpdate({ id: req.params.id }, req.body, {
      upsert: true,
      new: true
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.delete("/deals/:id", async (req, res) => {
  try {
    await BaseDeal.deleteOne({ id: req.params.id });
    await MonthRecord.deleteMany({ dealId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Months ────────────────────────────────────────────────────
r.get("/months", async (req, res) => {
  try {
    const docs = await MonthMeta.find({}, { _id: 0 });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.post("/months/next", async (req, res) => {
  try {
    const { fromMonthId, newMonthId, label } = req.body;
    const now = new Date().toISOString();

    const [baseDeals, fromRecords] = await Promise.all([
      BaseDeal.find({}, { _id: 0 }),
      MonthRecord.find({ monthId: fromMonthId }, { _id: 0 })
    ]);

    const recordMap = new Map(fromRecords.map((r) => [r.dealId, r]));
    const openDeals = baseDeals.filter((d) => d.remainingAmount > 0);

    await MonthMeta.findOneAndUpdate(
      { id: newMonthId },
      { id: newMonthId, label, createdAt: now },
      { upsert: true }
    );

    await Promise.all(
      openDeals.map((deal) => {
        const rec = {
          id: `${newMonthId}:${deal.id}`,
          monthId: newMonthId,
          dealId: deal.id,
          received: 0,
          receipts: [],
          snapshotRecovered: deal.recoveredAmount,
          snapshotRemaining: deal.remainingAmount,
          createdAt: now,
          updatedAt: now
        };
        return MonthRecord.findOneAndUpdate({ id: rec.id }, rec, {
          upsert: true
        });
      })
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Month Records ─────────────────────────────────────────────
r.get("/month-records/:monthId", async (req, res) => {
  try {
    const docs = await MonthRecord.find(
      { monthId: req.params.monthId },
      { _id: 0 }
    );
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put("/month-records", async (req, res) => {
  try {
    const records = req.body;
    await Promise.all(
      records.map((rec) =>
        MonthRecord.findOneAndUpdate({ id: rec.id }, rec, { upsert: true })
      )
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put("/month-records/:id", async (req, res) => {
  try {
    await MonthRecord.findOneAndUpdate({ id: req.params.id }, req.body, {
      upsert: true
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Propagate snapshots forward ───────────────────────────────
r.post("/propagate-snapshot", async (req, res) => {
  try {
    const { dealId, fromMonthId, newRecovered, newRemaining } = req.body;

    const [allMonths, allRecords] = await Promise.all([
      MonthMeta.find({}, { _id: 0 }),
      MonthRecord.find({ dealId }, { _id: 0 })
    ]);

    const laterMonthIds = new Set(
      allMonths.filter((m) => m.id > fromMonthId).map((m) => m.id)
    );

    const toUpdate = allRecords.filter((r) => laterMonthIds.has(r.monthId));
    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map((rec) =>
          MonthRecord.findOneAndUpdate(
            { id: rec.id },
            {
              snapshotRecovered: newRecovered,
              snapshotRemaining: newRemaining,
              updatedAt: new Date().toISOString()
            }
          )
        )
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Meta (activeMonthId, formulas) ───────────────────────────
r.get("/meta/:key", async (req, res) => {
  try {
    const doc = await Meta.findOne({ key: req.params.key });
    res.json({ value: doc ? doc.value : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put("/meta/:key", async (req, res) => {
  try {
    await Meta.findOneAndUpdate(
      { key: req.params.key },
      { key: req.params.key, value: req.body.value },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;

// ── Delete a month ────────────────────────────────────────────
r.delete("/months/:monthId", async (req, res) => {
  try {
    const { monthId } = req.params;
    await Promise.all([
      MonthMeta.deleteOne({ id: monthId }),
      MonthRecord.deleteMany({ monthId })
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── All receipts for a deal (across all months) ───────────────
r.get("/deals/:dealId/all-records", async (req, res) => {
  try {
    const docs = await MonthRecord.find(
      { dealId: req.params.dealId, "receipts.0": { $exists: true } },
      { _id: 0 }
    ).sort({ monthId: -1 });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
