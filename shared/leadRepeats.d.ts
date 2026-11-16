export const LEAD_REPEATS_KEY: string;
export type LeadRepeat = {
  id: string;
  phone: string;
  name: string;
  formName: string;
  campaignAt: string;
  createdAt: string;
};
export function repeatPhoneKey(value: any): string;
export function repeatIdOf(phoneKey: string, formName: string, when: string): string;
export function buildRepeats(params: { rows?: any[]; records?: any[]; existing?: any[]; at?: string }): LeadRepeat[];
export function repeatsByPhone(list?: any[]): Map<string, LeadRepeat[]>;
export function repeatLabel(entries?: LeadRepeat[]): string;
export function allFormsOfPhone(map: any, originForm?: string, ...phones: any[]): string[];
export function repeatLabelForForm(map: any, currentForm?: string, originForm?: string, ...phones: any[]): string;
