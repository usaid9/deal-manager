import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import routes from "./routes.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api", routes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const MONGO_URI = process.env.MONGO_URI || "mongodb://usaidahmad:usaid598@ac-83vrxim-shard-00-00.pfwirjw.mongodb.net:27017,ac-83vrxim-shard-00-01.pfwirjw.mongodb.net:27017,ac-83vrxim-shard-00-02.pfwirjw.mongodb.net:27017/deal-manager?ssl=true&replicaSet=atlas-z3cf6q-shard-0&authSource=admin&appName=deals";
const PORT = process.env.PORT || 4000;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected!");
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });
