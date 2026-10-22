// أنواع وحدة التوزيع التلقائي (التنفيذ في shared/autoAssign.js)
export type AutoAssignRule = {
  id: string;
  formName: string;
  salesIds: string[];
  active: boolean;
  updatedAt: string;
};

export type LeadAssignment = { id: string; salesId: string };

export type DistributionResult = { assignments: LeadAssignment[]; loads: Record<string, number> };

export type AutoRulesResult = {
  leads: any[];
  assignments: LeadAssignment[];
  byRule: Record<string, number>;
};

export declare const AUTO_ASSIGN_KEY: string;
export declare function isAssignableSales(user: any): boolean;
export declare function formNameOfLead(lead: any): string;
export declare function normalizeRule(raw: any): AutoAssignRule | null;
export declare function parseRules(raw: any): AutoAssignRule[];
export declare function activeRuleFor(rules: AutoAssignRule[], formName: string): AutoAssignRule | null;
export declare function upsertRule(rules: AutoAssignRule[], patch: { formName: string; salesIds: string[]; active?: boolean }, at?: string): AutoAssignRule[];
export declare function distributeLeads(params: {
  leads?: any[];
  salesIds?: string[];
  formName?: string;
  formOf?: (lead: any) => string;
  onlyUnassigned?: boolean;
}): DistributionResult;
export declare function applyAutoRules(params: {
  leads?: any[];
  rules?: AutoAssignRule[];
  activeSalesIds?: string[];
  formOf?: (lead: any) => string;
}): AutoRulesResult;
