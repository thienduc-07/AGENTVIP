"""
PROVIPAGENT Phase 4.3.7: Security Sanitizer & Redaction Engine
Comprehensive secret redaction, ANSI/OSC terminal injection defense,
and path traversal protection.
"""
import re
import html
from typing import Optional

# =============================================================================
# SECRET DETECTION PATTERNS
# =============================================================================
_SECRET_PATTERNS = [
    # 1. Bearer tokens
    (re.compile(r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE), r"\1[REDACTED]"),
    # 2. OpenAI keys
    (re.compile(r"\bsk-[A-Za-z0-9\-_]{8,}\b"), "sk-[REDACTED]"),
    # 3. Anthropic keys
    (re.compile(r"\bsk-ant-[A-Za-z0-9\-_]{8,}\b"), "sk-ant-[REDACTED]"),
    # 4. Groq keys
    (re.compile(r"\bgsk_[A-Za-z0-9\-_]{8,}\b"), "gsk_[REDACTED]"),
    # 5. Google / Gemini API keys
    (re.compile(r"\bAIza[0-9A-Za-z\-_]{12,}\b"), "AIza[REDACTED]"),
    # 6. AWS Access Keys
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AKIA[REDACTED]"),
    # 7. GitHub Tokens
    (re.compile(r"\bghp_[0-9a-zA-Z]{20,}\b"), "ghp_[REDACTED]"),
    (re.compile(r"\bgithub_pat_[0-9a-zA-Z_]{20,}\b"), "github_pat_[REDACTED]"),
    # 8. Private Key Blocks (RSA, EC, OpenSSH, DSA, Generic)
    (
        re.compile(r"-----BEGIN (?:[A-Z0-9\-_]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9\-_]+ )?PRIVATE KEY-----"),
        "[REDACTED_PRIVATE_KEY]",
    ),
    # 9. Database Connection URLs with Passwords (postgres, mysql, redis, mongodb, etc.)
    (
        re.compile(r"\b([a-zA-Z][a-zA-Z0-9+.-]+://[^:\s/@]+):([^\s/]+)@([a-zA-Z0-9.\-_]+(?::\d+)?(?:/[^\s]*)?)", re.IGNORECASE),
        r"\1:[REDACTED]@\3",
    ),
    # 10. Explicit Key/Secret/Password Assignments (JSON, YAML, .env, or CLI args)
    (
        re.compile(
            r"""((?:api[_-]?key|token|secret|password|passwd|pwd|client_secret)\s*[:=]\s*['"]?)[^\s,'"]{4,}(['"]?)""",
            re.IGNORECASE,
        ),
        r"\1[REDACTED]\2",
    ),
    # 11. Generic JWTs (header.payload.signature)
    (
        re.compile(r"\beyJ[A-Za-z0-9-_=]{10,}\.eyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_.+/=]{10,}\b"),
        "[REDACTED_JWT]",
    ),
]

# =============================================================================
# DANGEROUS TERMINAL ESCAPE & CONTROL SEQUENCES
# =============================================================================
# OSC (Operating System Command) sequences (e.g. \x1b]0;title\x07 or \x1b]52;...\x1b\\)
_OSC_PATTERN = re.compile(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)")
# Non-color CSI sequences (e.g. cursor moves, clear screen, status report)
_CSI_NON_COLOR_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-HJ-NP-Za-z]")
# Raw Control Characters (null, bell, backspace, form feed) except newline/tab
_DANGEROUS_CTRL_CHARS = re.compile(r"[\x00\x07\x08\x0b\x0c\x0e\x0f]")
# Dangerous HTML script/iframe tags
_HTML_TAGS_PATTERN = re.compile(r"<\s*(script|iframe|object|embed|svg|style)[^>]*>[\s\S]*?<\s*/\s*\1\s*>", re.IGNORECASE)
_HTML_SELF_CLOSING = re.compile(r"<\s*(script|iframe|object|embed|img|svg)[^>]*>", re.IGNORECASE)


def redact_secrets(text: Optional[str]) -> str:
    """
    Scrubs API keys, Bearer tokens, private keys, database credentials,
    and passwords from text before logging, database persistence, or WebSocket broadcast.
    """
    if not text:
        return ""
    sanitized = str(text)
    for pattern, replacement in _SECRET_PATTERNS:
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized


def sanitize_terminal_text(text: Optional[str], max_length: int = 4000) -> str:
    """
    Sanitizes terminal output text:
    1. Redacts secrets and credentials.
    2. Strips OSC and non-color CSI terminal escape sequences that can cause terminal injection.
    3. Removes dangerous control characters.
    4. Neutralizes HTML injection attempts.
    5. Bounds maximum length to prevent denial-of-service / buffer overflow.
    """
    if not text:
        return ""

    sanitized = redact_secrets(text)

    # 1. Strip OSC sequences
    sanitized = _OSC_PATTERN.sub("", sanitized)

    # 2. Strip non-color CSI sequences
    sanitized = _CSI_NON_COLOR_PATTERN.sub("", sanitized)

    # 3. Strip dangerous control characters
    sanitized = _DANGEROUS_CTRL_CHARS.sub("", sanitized)

    # 4. Neutralize HTML script and iframe tags
    sanitized = _HTML_TAGS_PATTERN.sub("[SANITIZED_TAG]", sanitized)
    sanitized = _HTML_SELF_CLOSING.sub("[SANITIZED_TAG]", sanitized)

    # 5. Bound length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + " ... [TRUNCATED]"

    return sanitized


def sanitize_file_path(file_path: Optional[str], max_length: int = 500) -> str:
    """
    Sanitizes a file path for terminal logging and WebSocket envelopes:
    1. Removes null bytes.
    2. Detects and neutralizes directory traversal sequences ('../', '..\\').
    3. Redacts user home directory prefixes to avoid internal environment leakage.
    4. Bounds path length.
    """
    if not file_path:
        return ""

    path_str = str(file_path).replace("\x00", "").strip()

    # Detect traversal attempts
    if ".." in path_str:
        # Neutralize traversal tokens safely
        path_str = re.sub(r"\.\.[/\\]+", "[TRAVERSAL_PREVENTED]/", path_str)

    # Redact user home paths (e.g., /Users/thienduc/ or /home/username/)
    path_str = re.sub(r"^/Users/[^/]+/", "~/", path_str)
    path_str = re.sub(r"^/home/[^/]+/", "~/", path_str)

    if len(path_str) > max_length:
        path_str = path_str[:max_length]

    return path_str
