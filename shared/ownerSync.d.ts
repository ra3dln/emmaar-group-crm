export const OWNER_SETTLE_MS: number;
export function reconcileOwners(params?: { leads?: any[]; clients?: any[]; userIds?: string[]; now?: number }): {
  clientFixes: Array<{ id: string; owner: string; via: 'manual' | 'auto' }>;
  leadFixes: Array<{ id: string; owner: string }>;
};
