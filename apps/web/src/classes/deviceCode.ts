/** Personal code remembered on the student's own device, only with explicit consent (C5.5). One code per device. */
const KEY = 'kvizhub-student-code';

export function readDeviceCode(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function saveDeviceCode(code: string): boolean {
  try {
    localStorage.setItem(KEY, code);
    return true;
  } catch {
    return false;
  }
}
export function forgetDeviceCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
