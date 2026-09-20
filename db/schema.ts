import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [index("runs_created_at_idx").on(t.createdAt)],
);
