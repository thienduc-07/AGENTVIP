from typing import Optional, Dict, Any
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

class AppException(Exception):
    def __init__(self, code: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class NotFoundError(AppException):
    def __init__(self, message: str = "Resource not found", code: str = "NOT_FOUND"):
        super().__init__(code=code, message=message, status_code=status.HTTP_404_NOT_FOUND)

class ValidationError(AppException):
    def __init__(self, message: str = "Validation failed", code: str = "VALIDATION_ERROR"):
        super().__init__(code=code, message=message, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY)

class ConflictError(AppException):
    def __init__(self, message: str = "Resource state conflict", code: str = "CONFLICT"):
        super().__init__(code=code, message=message, status_code=status.HTTP_409_CONFLICT)

class ForbiddenError(AppException):
    def __init__(self, message: str = "Forbidden", code: str = "FORBIDDEN"):
        super().__init__(code=code, message=message, status_code=status.HTTP_403_FORBIDDEN)

class PermissionDeniedError(ForbiddenError):
    def __init__(self, message: str = "Permission denied", code: str = "PERMISSION_DENIED"):
        super().__init__(message=message, code=code)

def format_error_response(code: str, message: str, status_code: int, headers: Optional[Dict[str, str]] = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": {
                "code": code,
                "message": message
            }
        }
    )

async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    return format_error_response(code=exc.code, message=exc.message, status_code=exc.status_code)

async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    msg = errors[0]["msg"] if errors else "Invalid request data"
    loc = " -> ".join(str(l) for l in errors[0].get("loc", [])) if errors else ""
    full_message = f"{msg} (at {loc})" if loc else msg
    return format_error_response(code="VALIDATION_ERROR", message=full_message, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY)

async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code_map = {
        404: "NOT_FOUND",
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        409: "CONFLICT",
        422: "UNPROCESSABLE_ENTITY",
        500: "INTERNAL_SERVER_ERROR"
    }
    code = code_map.get(exc.status_code, "ERROR")
    message = str(exc.detail) if exc.detail else "An HTTP error occurred"
    return format_error_response(code=code, message=message, status_code=exc.status_code, headers=getattr(exc, "headers", None))

async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return format_error_response(
        code="INTERNAL_SERVER_ERROR",
        message="An unexpected server error occurred",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR
    )

def setup_exception_handlers(app):
    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)

