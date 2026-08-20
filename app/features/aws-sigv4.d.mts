export type AwsSigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
};

export function normalizeAwsSigV4Credentials(value: AwsSigV4Credentials): Required<AwsSigV4Credentials>;
export function createAwsSigV4Headers(
  credentials: AwsSigV4Credentials,
  request: { method: "GET" | "HEAD" | "PUT"; url: string; headers?: Record<string, string>; body?: string },
  now?: string | Date,
): Promise<Record<string, string>>;
