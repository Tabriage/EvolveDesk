export type AwsSigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  expiresAt?: string | number;
};

export const AWS_CREDENTIAL_EXPIRY_WARNING_MS: number;
export const AWS_CREDENTIAL_MIN_VALIDITY_MS: number;
export type AwsCredentialLifecycle = {
  status: "long-lived" | "unknown" | "valid" | "expiring" | "expired";
  expiresAt: string;
  remainingMs: number | null;
  usable: boolean;
  renewalRecommended: boolean;
};

export function normalizeAwsSigV4Credentials(value: AwsSigV4Credentials): { accessKeyId: string; secretAccessKey: string; sessionToken: string; region: string; expiresAt: string };
export function inspectAwsCredentialLifecycle(value: Pick<AwsSigV4Credentials, "sessionToken" | "expiresAt">, now?: string | Date): AwsCredentialLifecycle;
export function assertAwsCredentialUsable(value: Pick<AwsSigV4Credentials, "sessionToken" | "expiresAt">, now?: string | Date): AwsCredentialLifecycle;
export function createAwsSigV4Headers(
  credentials: AwsSigV4Credentials,
  request: { method: "GET" | "HEAD" | "PUT"; url: string; headers?: Record<string, string>; body?: string },
  now?: string | Date,
): Promise<Record<string, string>>;
