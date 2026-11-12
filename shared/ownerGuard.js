// ===== التوزيع اليدوي يكسب التلقائي =====
// التوزيع التلقائي بيشتغل في متصفح كل حساب إدارة مفتوح. جهاز لسه ما وصلوش
// اختيار الإدارة اليدوي ممكن يشوف الرقم «غير مخصص» فيوزّعه تلقائي، وتسجيله
// بيبقى أحدث — فكان بيكتب فوق اختيار الإدارة.
// القاعدة (نفسها في السيرفر وفي مزامنة كل جهاز): بين نسختين من نفس الرقم/العميل،
// لو واحدة صاحبها اتحدد يدوي والتانية تلقائي وصاحبهم مختلف، صاحب اليدوي يفضل
// مهما كان وقت الحفظ. ولو الاتنين يدوي (أو الاتنين تلقائي) الأحدث يكسب زي الأول.

const OWNER_FIELDS = {
  crm_assigned_leads: { via: 'assignedVia', fields: ['salesId', 'assignedAt'] },
  crm_clients: { via: 'ownerVia', fields: ['userId', 'assignedTo'] },
};

const ownerOf = (spec, record) => String(record?.[spec.fields[0]] || '');

// winner = النسخة اللي كسبت بالوقت، other = التانية. يرجّع winner بصاحب اليدوي لو لزم.
export function keepManualOwner(key, winner, other) {
  const spec = OWNER_FIELDS[key];
  if (!spec || !winner || !other) return winner;
  const winnerManual = winner[spec.via] === 'manual';
  const otherManual = other[spec.via] === 'manual';
  if (winnerManual || !otherManual) return winner;
  if (ownerOf(spec, winner) === ownerOf(spec, other)) return winner;
  const patched = { ...winner, [spec.via]: 'manual' };
  for (const field of spec.fields) patched[field] = other[field];
  return patched;
}
