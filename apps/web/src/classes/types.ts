export interface ClassDto {
  id: string;
  name: string;
  schoolYear: string;
  subject: string | null;
  status: 'active' | 'archived';
  role: 'owner' | 'editor' | 'viewer';
  settings: { supportThresholdPercent: number; trendDropPp: number; halfYearSplit: string };
  schoolYearEnd: string;
  archivedAt: number | null;
  anonymizeAt?: number;
  students?: StudentDto[];
}

export interface StudentDto {
  id: string;
  familyName: string;
  givenName: string;
  publicName: string;
  rosterNo: number | null;
  active: boolean;
  since: string;
  leftAt: string | null;
}

export interface CreatedCode {
  student: StudentDto;
  code: string;
}

export const fullName = (s: { familyName: string; givenName: string }) => `${s.familyName} ${s.givenName}`.trim();

/** Per-browser preference "Zobrazit celá jména" (C6.2, C8). */
export function useShowNamesKey() {
  return 'kvizhub-show-names';
}
export function readShowNames(defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem('kvizhub-show-names');
    return v === null ? defaultValue : v === '1';
  } catch {
    return defaultValue;
  }
}
export function writeShowNames(v: boolean) {
  try {
    localStorage.setItem('kvizhub-show-names', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
