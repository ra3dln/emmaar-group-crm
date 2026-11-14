export const LEAD_ANSWERS_KEY: string;
export type FormAnswer = { q: string; a: string };
export type LeadAnswerEntry = {
  id: string;
  phone: string;
  formName: string;
  campaignAt: string;
  answers: FormAnswer[];
  createdAt: string;
};
export function questionLabel(name: string): string;
export function answerText(values: any): string;
export function answersFromFields(fieldData?: any[]): FormAnswer[];
export function buildAnswerEntries(params?: { rows?: any[]; existing?: any[]; at?: string }): LeadAnswerEntry[];
export function answersByPhone(list?: any[]): Map<string, LeadAnswerEntry[]>;
