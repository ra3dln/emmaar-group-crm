export function reconcileOwners(params?: { leads?: any[]; clients?: any[]; userIds?: string[] }): {
  clientFixes: Array<{ id: string; owner: string; via: 'manual' | 'auto' }>;
  leadFixes: Array<{ id: string; owner: string }>;
};
