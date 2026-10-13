export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface ProfileEndpoint {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: JsonValue;
}
export interface ProviderProtocolProfile {
  id: string;
  revision: number;
  submit: ProfileEndpoint;
  poll: ProfileEndpoint;
  cancel?: ProfileEndpoint;
  mapping: {
    jobId: string;
    status: string;
    resultUrl: string;
    error?: string;
    usageMinor?: string;
    states: Record<
      string,
      'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    >;
  };
}
