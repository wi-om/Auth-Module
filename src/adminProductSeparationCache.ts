import type { SetupConfig } from './setupStore';

const separationReadyKeys = new Set<string>();

export function adminProductSeparationKey(setup: SetupConfig): string {
  return `${setup.databaseUrl}\0${setup.companyId}`;
}

export function isAdminProductSeparationReady(setup: SetupConfig): boolean {
  return separationReadyKeys.has(adminProductSeparationKey(setup));
}

export function markAdminProductSeparationReady(setup: SetupConfig): void {
  separationReadyKeys.add(adminProductSeparationKey(setup));
}

export function invalidateAdminProductSeparation(setup: SetupConfig): void {
  separationReadyKeys.delete(adminProductSeparationKey(setup));
}
