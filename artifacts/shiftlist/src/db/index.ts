import { db } from "@workspace/db";

export const pool = db.$client;

export interface Employee {
  id: number;
  name: string;
  code: string;
}

export interface ShiftTemplate {
  id: number;
  shift_name: string;
  task_text: string;
  display_order: number;
}

export interface ScheduledTask {
  id: number;
  employee_id: number;
  target_date: string;
  task_text: string;
  employee_name?: string;
}

export interface ShiftAssignment {
  id: number;
  employee_id: number;
  date: string;
  shift_name: string;
  employee_name?: string;
}
