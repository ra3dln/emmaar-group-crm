// أنواع العميل التلقائي (المقابل المكتوب لـ shared/leadClients.js)
export declare const LEAD_CLIENT_ID_PREFIX: string;

export declare function leadClientIdFor(phone?: unknown): string;

export declare function campaignAtFromText(text?: unknown): string;

export declare function campaignTimeOf(record?: any): { at: string; kind: 'campaign' | 'added' };
// الترتيب من الأحدث للأقدم بوقت التسجيل في الكامبين (وإلا وقت الإضافة)
export declare function campaignTimeMs(record?: any): number;
export declare function newestFirst(list: any[], pick?: (item: any) => any): any[];

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

// كومنت الإدارة على الرقم → حدث فيدباك في خط العميل (أو null لو مفيش كومنت)
export declare function leadCommentActivity(lead?: any): { id: string; type: string; text: string; at: string; by: string } | null;
