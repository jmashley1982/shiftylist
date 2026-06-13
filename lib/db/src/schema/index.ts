import { pgTable, serial, text, integer, boolean, unique, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });

// Reusable master task list
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });

// Shift types (Open, Mid, Close, …)
export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });

// Tasks assigned to each shift template (reusable, ordered)
export const shiftTasks = pgTable("shift_tasks", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").default(0).notNull(),
}, (table) => [
  unique().on(table.shiftId, table.taskId),
]);

export const insertShiftTaskSchema = createInsertSchema(shiftTasks).omit({ id: true });

// Extra tasks added for a specific date + shift (additive only, do not replace the standing list)
export const extraDayTasks = pgTable("extra_day_tasks", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  taskName: text("task_name").notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
});

export const insertExtraDayTaskSchema = createInsertSchema(extraDayTasks).omit({ id: true });

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export type Shift = typeof shifts.$inferSelect;
export type InsertShift = typeof shifts.$inferInsert;

export type ShiftTask = typeof shiftTasks.$inferSelect;
export type InsertShiftTask = typeof shiftTasks.$inferInsert;

export type ExtraDayTask = typeof extraDayTasks.$inferSelect;
export type InsertExtraDayTask = typeof extraDayTasks.$inferInsert;

// Shift submission reports (replaces Google Sheets; deleted after 30 days)
export const submissions = pgTable("submissions", {
  id: serial("id").primaryKey(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  shiftName: text("shift_name").notNull(),
  date: text("date").notNull(),
  taskSummary: text("task_summary").notNull(),
  notes: text("notes").notNull().default(""),
});

export type Submission = typeof submissions.$inferSelect;
export type InsertSubmission = typeof submissions.$inferInsert;
