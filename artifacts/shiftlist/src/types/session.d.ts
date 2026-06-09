import "express-session";

declare module "express-session" {
  interface SessionData {
    employeeId?: number;
    employeeName?: string;
    employeeShift?: string;
    employeeCode?: string;
    isAdmin?: boolean;
    pendingEmployee?: {
      id: number;
      name: string;
      code: string;
    };
  }
}
