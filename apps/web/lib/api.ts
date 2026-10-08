import type { ApiErrorShape } from "./types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;

  constructor(code: string, message: string, status: number, requestId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = "INTERNAL_ERROR";
  let message = `Request failed (${res.status})`;
  let requestId: string | undefined;
  try {
    const body = (await res.json()) as ApiErrorShape;
    if (body?.error?.code) {
      code = body.error.code;
      message = body.error.message || message;
      requestId = body.error.request_id;
    }
  } catch {
    // Non-JSON error body — keep the generic message.
  }
  return new ApiError(code, message, res.status, requestId);
}

export interface RequestOptions {
  token?: string | null;
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiFetchRaw(path, options);
  return (await res.json()) as T;
}

export async function apiFetchRaw(
  path: string,
  options: RequestOptions = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
    signal: options.signal,
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return res;
}
