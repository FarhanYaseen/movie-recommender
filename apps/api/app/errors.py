# app/errors.py
# API error types and the contract error shape:
# { "error": { "code", "message", "request_id" } }

from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 500, code: str = "INTERNAL_ERROR"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class ValidationApiError(ApiError):
    def __init__(self, message: str):
        super().__init__(message, 400, "VALIDATION_ERROR")


class UnauthorizedError(ApiError):
    def __init__(self, message: str = "Authentication required"):
        super().__init__(message, 401, "UNAUTHORIZED")


class ForbiddenError(ApiError):
    def __init__(self, message: str = "Not allowed"):
        super().__init__(message, 403, "FORBIDDEN")


class NotFoundError(ApiError):
    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, 404, "NOT_FOUND")


class RateLimitedError(ApiError):
    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(message, 429, "RATE_LIMITED")


class UpstreamError(ApiError):
    def __init__(self, message: str = "Upstream provider error"):
        super().__init__(message, 502, "UPSTREAM_ERROR")


class NotConfiguredError(ApiError):
    def __init__(self, message: str = "Feature not configured"):
        super().__init__(message, 503, "NOT_CONFIGURED")


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message, "request_id": request_id_var.get()}}
