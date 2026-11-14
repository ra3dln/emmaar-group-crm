// ===== لافتة «متكرر في فورم كذا» =====
// التكرارات بيكتبها السيرفر وقت السحب (crm_lead_repeats) — هنا بنقراها وبنعرضها
// جنب الرقم. الرقم نفسه وصاحبه ما بيتغيّروش.
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { SYNC_EVENT } from './sync';
import { LEAD_REPEATS_KEY, repeatLabel, repeatPhoneKey, repeatsByPhone, type LeadRepeat } from '../shared/leadRepeats.js';

const readRepeats = (): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEAD_REPEATS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// خريطة الرقم ← تكراراته (بتتحدّث مع كل مزامنة)
export const useLeadRepeats = (): Map<string, LeadRepeat[]> => {
  const [map, setMap] = useState(() => repeatsByPhone(readRepeats()));
  useEffect(() => {
    const refresh = () => setMap(repeatsByPhone(readRepeats()));
    window.addEventListener(SYNC_EVENT, refresh);
    return () => window.removeEventListener(SYNC_EVENT, refresh);
  }, []);
  return map;
};

// نص اللافتة لرقم معيّن (فاضي لو مش متكرر)
export const repeatTextOf = (map: Map<string, LeadRepeat[]>, ...phones: any[]): string => {
  const entries: LeadRepeat[] = [];
  const seen = new Set<string>();
  for (const phone of phones.flat()) {
    for (const entry of map.get(repeatPhoneKey(phone)) || []) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return repeatLabel(entries);
};

export function LeadRepeatBadge({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-bold text-[var(--warn)] bg-[var(--tint-1)] border border-[var(--warn)] rounded-full px-2 py-0.5 max-w-full"
      title={text}
    >
      <Copy className="w-3 h-3 shrink-0" />
      <span className="truncate" translate="no">{text}</span>
    </span>
  );
}
