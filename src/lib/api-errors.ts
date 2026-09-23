import { NextResponse } from "next/server";

/**
 * The one shape in which the HTTP door `/api/v1` reports errors: a stable
 * `code` for programs and a `message` for people. No internals leak out —
 * no stack trace, no database error, no hint whether a foreign id exists.
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  /** Key valid, but the PERSON behind it lost product access (contract code). */
  | "KEY_OWNER_NO_ACCESS"
  | "KEY_REVOKED"
  | "KEY_CHECK_UNAVAILABLE"
  | "internal_error";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: { path: string; message: string }[];
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: ApiErrorBody["error"]["fields"],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(error: ApiError): NextResponse<ApiErrorBody> {
  return NextResponse.json<ApiErrorBody>(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Wrap every route body: unexpected errors become JSON, not an HTML page. */
export async function withErrorEnvelope(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    console.error("[api/v1] unexpected error:", error);
    return apiErrorResponse(new ApiError(500, "internal_error", "Unexpected error."));
  }
}

/** JSON answer, always `no-store`: tenant data belongs in no cache. */
export function apiJson<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_request", "The body is not valid JSON.");
  }
}

export function zodToApiError(error: { issues: { path: PropertyKey[]; message: string }[] }): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    "Invalid input. See `fields`.",
    error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}
