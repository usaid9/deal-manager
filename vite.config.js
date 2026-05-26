import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    base: "./",
    server: {
        port: 5173,
    },
    optimizeDeps: {
        // Let Vite CJS-wrap dexie so its default export resolves correctly.
        // RxDB and its plugins must stay excluded (pure ESM).
        exclude: ["rxdb", "rxdb/plugins/storage-dexie",
            "rxdb/plugins/dev-mode", "rxdb/plugins/migration-schema",
            "rxdb/plugins/update", "rxdb/plugins/query-builder",
            "rxdb/plugins/replication"],
        include: ["dexie"],
    },
    build: {
        chunkSizeWarningLimit: 1000,
    },
});
