/** Kept apart from xlsx.ts so the UI can name these without pulling the lazy-loaded workbook code into the main bundle. */
export class WorkbookError extends Error {}

export interface WorkbookMeta {
  exportedAt: string | null;
  appVersion: string | null;
  rulesVersion: number | null;
  billsDeclared: number | null;
  checksum: string | null;
}
