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

// ===== تفاصيل الأيام في التقرير الشهري =====
// صف لكل يوم في الشهر (لحد النهارده لو الشهر الحالي) لكل سيلز: التاريخ واسم اليوم
// ووقت الحضور والانصراف والتأخير والحالة — عشان المحاسبة تشوف «أنهي أيام» مش العدد بس.

export const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export type AttendanceDayRecord = { date: string; checkInAt: string; checkOutAt?: string };

export type AttendanceDayRow = {
  date: string; // YYYY-MM-DD
  dayName: string;
  checkIn: string; // "10:12" أو "—"
  checkOut: string;
  late: number; // دقائق التأخير بعد السماحية
  early: number; // دقائق الانصراف المبكر
  workedHours: number;
  status: string; // حاضر / متأخر / انصراف مبكر / بلا انصراف / غياب / راحة
};

export const attendanceDayRows = ({
  year,
  month, // 1-12
  records,
  start = ATTENDANCE_START_DEFAULT,
  grace = ATTENDANCE_GRACE_DEFAULT,
  end = ATTENDANCE_END_DEFAULT,
  restDay = '5', // رقم اليوم (0 = الأحد) أو 'none'
  today = new Date(),
}: {
  year: number;
  month: number;
  records: AttendanceDayRecord[];
  start?: string;
  grace?: number;
  end?: string;
  restDay?: string;
  today?: Date;
}): AttendanceDayRow[] => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const isFutureMonth = year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth() + 1);
  const upto = isFutureMonth ? 0 : isCurrentMonth ? today.getDate() : last;
  const byDate = new Map<string, AttendanceDayRecord>();
  for (const rec of records || []) if (rec?.date && !byDate.has(rec.date)) byDate.set(rec.date, rec);

  const rows: AttendanceDayRow[] = [];
  for (let day = 1; day <= upto; day += 1) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const weekday = new Date(year, month - 1, day).getDay();
    const rec = byDate.get(date);
    const isRest = restDay !== 'none' && weekday === Number(restDay);
    const late = rec ? lateMinutes(rec.checkInAt, start, grace) : 0;
    const early = rec?.checkOutAt ? earlyMinutes(rec.checkOutAt, end) : 0;
    const worked = rec?.checkOutAt
      ? Math.max(0, Math.round((Date.parse(rec.checkOutAt) - Date.parse(rec.checkInAt)) / 60000))
      : 0;
    let status = 'حاضر';
    if (!rec) status = isRest ? 'راحة' : 'غياب';
    else if (!rec.checkOutAt) status = late ? 'متأخر • بلا انصراف' : 'بلا انصراف';
    else if (late && early) status = 'متأخر • انصراف مبكر';
    else if (late) status = 'متأخر';
    else if (early) status = 'انصراف مبكر';
    rows.push({
      date,
      dayName: DAY_NAMES_AR[weekday],
      checkIn: rec ? clockLabel(minutesOfIso(rec.checkInAt)) : '—',
      checkOut: rec?.checkOutAt ? clockLabel(minutesOfIso(rec.checkOutAt)) : '—',
      late,
      early,
      workedHours: Math.round((worked / 60) * 10) / 10,
      status,
    });
  }
  return rows;
};

// نص خانة اليوم في ورقة «الأيام» بالإكسيل: الحضور - الانصراف + أي ملاحظة
// («10:05 - 18:00» / «10:45 - 18:00 • متأخر 15د» / «غياب» / «راحة»)
export const attendanceCellText = (row: AttendanceDayRow): string => {
  if (row.status === 'غياب' || row.status === 'راحة') return row.status;
  const notes: string[] = [];
  if (row.late) notes.push(`متأخر ${row.late}د`);
  if (row.early) notes.push(`مبكر ${row.early}د`);
  if (row.checkOut === '—') notes.push('بلا انصراف');
  const times = `${row.checkIn} - ${row.checkOut === '—' ? '؟' : row.checkOut}`;
  return notes.length ? `${times} • ${notes.join(' • ')}` : times;
};
