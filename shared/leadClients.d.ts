// أنواع العميل التلقائي (المقابل المكتوب لـ shared/leadClients.js)
export declare const LEAD_CLIENT_ID_PREFIX: string;

export declare function leadClientIdFor(phone?: unknown): string;

export declare function campaignAtFromText(text?: unknown): string;

export declare function campaignTimeOf(record?: any): { at: string; kind: 'campaign' | 'added' };

export declare function clientPhoneKeys(clients?: any[]): Set<string>;

export declare function buildLeadClients(options?: {
  leads?: any[];
  clients?: any[];
  extraPhones?: any[];
  at?: string;
  by?: string;
  // آخر كلام على كل رقم (المفتاح = أرقام الرقم) — بينزل مع الرقم على المندوب
  comments?: Map<string, { text?: string; at?: string; by?: string; status?: string }> | Record<string, any> | null;
}): any[];
