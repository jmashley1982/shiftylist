import { pgTable, serial, text, integer, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });

export const shiftTemplates = pgTable("shift_templates", {
  id: serial("id").primaryKey(),
  shiftName: text("shift_name").notNull(),
  taskText: text("task_text").notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
});

export const insertShiftTemplateSchema = createInsertSchema(shiftTemplates).omit({ id: true });

export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  targetDate: text("target_date").notNull(),
  taskText: text("task_text").notNull(),
});

export const insertScheduledTaskSchema = createInsertSchema(scheduledTasks).omit({ id: true });

export const shiftAssignments = pgTable("shift_assignments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  date: text("date").notNull(),
  shiftName: text("shift_name").notNull(),
}, (table) => [
  unique().on(table.employeeId, table.date),
]);

export const insertShiftAssignmentSchema = createInsertSchema(shiftAssignments).omit({ id: true });

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type InsertShiftTemplate = typeof shiftTemplates.$inferInsert;

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = typeof scheduledTasks.$inferInsert;

export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type InsertShiftAssignment = typeof shiftAssignments.$inferInsert;
