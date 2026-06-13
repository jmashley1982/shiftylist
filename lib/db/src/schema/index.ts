import { pgTable, serial, text, integer, date, boolean, unique, timestamp } from "drizzle-orm/pg-core";
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

// A shift scheduled for a specific day (with publish toggle)
export const dailyShifts = pgTable("daily_shifts", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  isPublished: boolean("is_published").default(false).notNull(),
}, (table) => [
  unique().on(table.date, table.shiftId),
]);

export const insertDailyShiftSchema = createInsertSchema(dailyShifts).omit({ id: true });

// Individual tasks for a specific day/shift (ordered, can differ from shift template)
export const dailyShiftTasks = pgTable("daily_shift_tasks", {
  id: serial("id").primaryKey(),
  dailyShiftId: integer("daily_shift_id").notNull().references(() => dailyShifts.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").default(0).notNull(),
}, (table) => [
  unique().on(table.dailyShiftId, table.taskId),
]);

export const insertDailyShiftTaskSchema = createInsertSchema(dailyShiftTasks).omit({ id: true });

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export type Shift = typeof shifts.$inferSelect;
export type InsertShift = typeof shifts.$inferInsert;

export type ShiftTask = typeof shiftTasks.$inferSelect;
export type InsertShiftTask = typeof shiftTasks.$inferInsert;

export type DailyShift = typeof dailyShifts.$inferSelect;
export type InsertDailyShift = typeof dailyShifts.$inferInsert;

export type DailyShiftTask = typeof dailyShiftTasks.$inferSelect;
export type InsertDailyShiftTask = typeof dailyShiftTasks.$inferInsert;
