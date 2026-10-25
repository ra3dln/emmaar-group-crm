// أنواع وحدة الرتب (التنفيذ في shared/roles.js)
export type RoleUser = {
  id?: string;
  username?: string;
  name?: string;
  role?: string;
  team?: string;
  developer?: boolean;
  receivesLeads?: boolean;
  dataScope?: string;
  isActive?: boolean;
};

export declare function isDeveloperAccount(user?: RoleUser | null): boolean;
export declare function worksAsSales(user?: RoleUser | null): boolean;
export declare function effectiveRoleOf(user?: RoleUser | null): string;
export declare function isManagerAccount(user?: RoleUser | null): boolean;
export declare function isAdminAccount(user?: RoleUser | null): boolean;
export declare function dataScopeOf(
  user?: (RoleUser & { id?: string }) | null,
  allUsers?: RoleUser[]
): Set<string> | null;
