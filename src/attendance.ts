// ===== حسابات الحضور والانصراف =====
// الدوام الافتراضي المتفق عليه: حضور 10:00 — سماحية 30 دقيقة — انصراف 18:00.
// منفصلة عن الواجهة حتى تُختبر بسهولة (tests/attendance.mjs).

export const ATTENDANCE_START_DEFAULT = '10:00';
export const ATTENDANCE_END_DEFAULT = '18:00';
export const ATTENDANCE_GRACE_DEFAULT = 30;

/** "10:30" => 630 دقيقة */
export const clockToMinutes = (value: string): number => {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
};

/** وقت ISO => دقائق من منتصف الليل بتوقيت الجهاز */
export const minutesOfIso = (iso?: string): number | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
};

/** دقائق التأخير بعد السماحية (10:31 => 1، 11:15 => 45) */
export const lateMinutes = (
  checkInAt: string | undefined,
  start = ATTENDANCE_START_DEFAULT,
  grace = ATTENDANCE_GRACE_DEFAULT
): number => {
  const mins = minutesOfIso(checkInAt);
  if (mins === null) return 0;
  const after = clockToMinutes(start) + Math.max(0, grace);
  return mins > after ? mins - after : 0;
};

/** دقائق الانصراف المبكر قبل نهاية الدوام (17:00 => 60) */
export const earlyMinutes = (
  checkOutAt: string | undefined,
  end = ATTENDANCE_END_DEFAULT
): number => {
  const mins = minutesOfIso(checkOutAt);
  if (mins === null) return 0;
  const endMins = clockToMinutes(end);
  return mins < endMins ? endMins - mins : 0;
};

/** دقائق => "10:30" */
export const clockLabel = (mins: number | null): string =>
  mins === null
    ? '—'
    : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
