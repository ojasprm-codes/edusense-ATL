import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const enquiries = sqliteTable(
  "enquiries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reference: text("reference").notNull().unique(),
    name: text("name").notNull(),
    school: text("school").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    interest: text("interest").notNull(),
    message: text("message").notNull(),
    deliveryStatus: text("delivery_status").notNull().default("pending_domain_setup"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_enquiries_created_at").on(table.createdAt)],
);
