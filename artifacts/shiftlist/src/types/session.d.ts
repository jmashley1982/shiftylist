import "express-session";

declare module "express-session" {
  interface SessionData {
    employeeId?: number;
    employeeName?: string;
    selectedShiftId?: number;
    employeeCode?: string;
    isAdmin?: boolean;
    pendingEmployee?: {
      id: number;
      name: string;
      code: string;
    };
  }
}
