# app/middleware/request_context.py
# Request IDs + normalized error responses per docs/contracts/ai-api.md

import logging
import secrets

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..errors import ApiError, error_body, request_id_var

logger = logging.getLogger("api")


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = "req_" + secrets.token_hex(8)
        request_id_var.set(request_id)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError):
        if exc.status_code >= 500:
            logger.error("[%s] %s: %s", request_id_var.get(), exc.code, exc.message)
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError):
        # Contract: FastAPI request-validation errors are normalized to 400
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(part) for part in first.get("loc", []) if part != "body")
        msg = first.get("msg", "Invalid request")
        message = f"{loc}: {msg}" if loc else msg
        return JSONResponse(status_code=400, content=error_body("VALIDATION_ERROR", message))

    @app.exception_handler(Exception)
    async def unexpected_handler(_request: Request, exc: Exception):
        logger.exception("[%s] unhandled error", request_id_var.get())
        return JSONResponse(
            status_code=500, content=error_body("INTERNAL_ERROR", "An unexpected error occurred")
        )
