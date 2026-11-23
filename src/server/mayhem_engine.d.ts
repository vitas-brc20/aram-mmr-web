export interface EngineResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer | Uint8Array;
}

export function handleApiRequest(
  pathname: string,
  method?: string,
  searchParams?: URLSearchParams,
  bodyBuffer?: Buffer | null
): Promise<EngineResponse>;
