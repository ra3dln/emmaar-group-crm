// ===== عيّنة من كومنتات الإنتاج (قراءة فقط) =====
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentActivitiesOf } from '../shared/comments.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
} catch {}
const { supabaseStorage } = await import('../server/supabase.js');
const storage = supabaseStorage({ ...process.env, ...env });
const db = await storage.load();
const clients = db.data?.crm_clients || [];
const cards = db.data?.crm_daily_feedback || [];

let totalComments = 0;
let withComments = 0;
for (const c of clients) {
  const list = commentActivitiesOf(c);
  if (list.length) withComments += 1;
  totalComments += list.length;
}
console.log(`العملاء: ${clients.length} | عندهم كومنت: ${withComments} | إجمالي الكومنتات: ${totalComments}`);
console.log(`بطاقات الفيدباك اليومي: ${cards.length}`);
console.log('نماذج من بطاقات الفيدباك اليومي:');
for (const card of cards.slice(0, 8)) {
  console.log(`  • ${card.clientName || ''} — ${JSON.stringify(card.feedback).slice(0, 70)}`);
}
console.log('نماذج:');
for (const c of clients.slice(0, 60)) {
  const list = commentActivitiesOf(c);
  if (!list.length) continue;
  console.log(`  • ${c.name} (${c.phone}) — ${list.length} كومنت`);
  for (const a of list.slice(0, 2)) {
    console.log(`      [${a.type}${a.status ? ' | ' + a.status : ''}] ${a.text} — ${a.at}`);
  }
}
