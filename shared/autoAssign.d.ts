// أنواع وحدة التوزيع التلقائي (التنفيذ في shared/autoAssign.js)
export type AutoAssignRule = {
  id: string;
  formName: string;
  salesIds: string[];
  // «كل السيلز»: التوزيع على كل من يستقبل أرقاماً، ومنهم أي حساب جديد
  allSales?: boolean;
  active: boolean;
  updatedAt: string;
};

// turnKey: مكان الرقم في الدور (التوزيع التلقائي بالدور بس)
export type LeadAssignment = { id: string; salesId: string; turnKey?: string };

export type DistributionResult = { assignments: LeadAssignment[]; loads: Record<string, number> };

export type AutoRulesResult = {
  leads: any[];
  assignments: LeadAssignment[];
  byRule: Record<string, number>;
};

export declare const AUTO_ASSIGN_KEY: string;
export declare function isAssignableSales(user: any): boolean;
export declare function formNameOfLead(lead: any): string;
export declare function phoneKeyOf(value: unknown): string;
export declare function normalizeRule(raw: any): AutoAssignRule | null;
export declare function parseRules(raw: any): AutoAssignRule[];
export declare function activeRuleFor(rules: AutoAssignRule[], formName: string): AutoAssignRule | null;
export declare function upsertRule(rules: AutoAssignRule[], patch: { formName: string; salesIds: string[]; allSales?: boolean; active?: boolean }, at?: string): AutoAssignRule[];
export declare function distributeLeads(params: {
  leads?: any[];
  // أرقام تُحسب منها حصص كل مندوب (الحمل الحقيقي) — بدونها تُحسب من leads
  loadLeads?: any[];
  salesIds?: string[];
  formName?: string;
  formOf?: (lead: any) => string;
  onlyUnassigned?: boolean;
  excludePhones?: string[];
  repeats?: any;
  at?: string;
}): DistributionResult;
export declare function turnKeyOf(lead: any): string;
export declare function lastTurnOwner(params: { loadLeads?: any[]; salesIds?: string[]; formName?: string; formOf?: (lead: any) => string }): string;
export declare function applyAutoRules(params: {
  leads?: any[];
  loadLeads?: any[];
  rules?: AutoAssignRule[];
  activeSalesIds?: string[];
  formOf?: (lead: any) => string;
  excludePhones?: string[];
  repeats?: any;
  at?: string;
}): AutoRulesResult;
