export type SyncStorageRecipeId = "http-gateway" | "cloudflare-r2" | "amazon-s3";
export type SyncStorageRecipe = {
  id: SyncStorageRecipeId;
  label: string;
  shortLabel: string;
  authType: "bearer" | "aws-sigv4";
  region: string;
  endpointPattern: string;
  credentialHint: string;
};

export const SYNC_STORAGE_RECIPES: readonly SyncStorageRecipe[];
export function getSyncStorageRecipe(id: SyncStorageRecipeId): SyncStorageRecipe;
export function normalizeSyncStorageObjectKey(value: string): string;
export function buildSyncStorageObjectUrl(recipeId: SyncStorageRecipeId, value: { objectUrl?: string; accountId?: string; bucket?: string; objectKey?: string; region?: string }): string;
export function createSyncStorageCorsPolicy(origin: string): Array<{
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
}>;
