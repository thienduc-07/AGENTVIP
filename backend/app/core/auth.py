import hmac
import hashlib
import json
import base64
import secrets
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Header, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from backend.app.core.config import settings, validate_signing_secret
from backend.app.core.database import get_db

# Security bearer scheme
security_scheme = HTTPBearer(auto_error=False)

# Supported JWT algorithm and expiration
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

def get_jwt_secret() -> str:
    """
    Retrieves and validates the JWT signing secret dynamically.
    Fails securely if secret is missing, empty, shorter than 32 bytes,
    or matches a known development default. Never logs or leaks the secret.
    """
    return validate_signing_secret()

# Roles
ROLE_PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN"
ROLE_ORGANIZATION_OWNER = "ORGANIZATION_OWNER"
ROLE_ORGANIZATION_ADMIN = "ORGANIZATION_ADMIN"
ROLE_ORGANIZATION_MANAGER = "ORGANIZATION_MANAGER"
ROLE_ORGANIZATION_MEMBER = "ORGANIZATION_MEMBER"

# Permissions
PERM_RECRUIT_SPECIALIST = "RECRUIT_SPECIALIST"
PERM_MANAGE_EMPLOYEE_LIFECYCLE = "MANAGE_EMPLOYEE_LIFECYCLE"
PERM_REASSIGN_WORKSTATION = "REASSIGN_WORKSTATION"
PERM_VIEW_WORKFORCE = "VIEW_WORKFORCE"
PERM_PREVIEW_CATALOG_SYNC = "PREVIEW_CATALOG_SYNC"
PERM_APPLY_CATALOG_SYNC = "APPLY_CATALOG_SYNC"
PERM_DECIDE_APPROVAL = "DECIDE_APPROVAL"

ROLE_PERMISSIONS: Dict[str, List[str]] = {
    ROLE_PLATFORM_SUPERADMIN: [
        PERM_RECRUIT_SPECIALIST,
        PERM_MANAGE_EMPLOYEE_LIFECYCLE,
        PERM_REASSIGN_WORKSTATION,
        PERM_VIEW_WORKFORCE,
        PERM_PREVIEW_CATALOG_SYNC,
        PERM_APPLY_CATALOG_SYNC,
        PERM_DECIDE_APPROVAL,
    ],
    ROLE_ORGANIZATION_OWNER: [
        PERM_RECRUIT_SPECIALIST,
        PERM_MANAGE_EMPLOYEE_LIFECYCLE,
        PERM_REASSIGN_WORKSTATION,
        PERM_VIEW_WORKFORCE,
        PERM_PREVIEW_CATALOG_SYNC,
        PERM_DECIDE_APPROVAL,
    ],
    ROLE_ORGANIZATION_ADMIN: [
        PERM_RECRUIT_SPECIALIST,
        PERM_MANAGE_EMPLOYEE_LIFECYCLE,
        PERM_REASSIGN_WORKSTATION,
        PERM_VIEW_WORKFORCE,
        PERM_PREVIEW_CATALOG_SYNC,
        PERM_DECIDE_APPROVAL,
    ],
    ROLE_ORGANIZATION_MANAGER: [
        PERM_MANAGE_EMPLOYEE_LIFECYCLE,
        PERM_REASSIGN_WORKSTATION,
        PERM_VIEW_WORKFORCE,
        PERM_DECIDE_APPROVAL,
    ],
    ROLE_ORGANIZATION_MEMBER: [
        PERM_VIEW_WORKFORCE,
    ],
}

# Aliases for role naming compatibility
ROLE_PERMISSIONS["OWNER"] = ROLE_PERMISSIONS[ROLE_ORGANIZATION_OWNER]
ROLE_PERMISSIONS["ADMIN"] = ROLE_PERMISSIONS[ROLE_ORGANIZATION_ADMIN]
ROLE_PERMISSIONS["MANAGER"] = ROLE_PERMISSIONS[ROLE_ORGANIZATION_MANAGER]
ROLE_PERMISSIONS["MEMBER"] = ROLE_PERMISSIONS[ROLE_ORGANIZATION_MEMBER]
ROLE_PERMISSIONS["SUPERADMIN"] = ROLE_PERMISSIONS[ROLE_PLATFORM_SUPERADMIN]

def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

def _b64decode(data: str) -> bytes:
    padding = 4 - (len(data) % 4)
    if padding < 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data.encode("utf-8"))

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return f"{salt}${key.hex()}"

def verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt, key_hex = hashed_password.split("$")
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
        return hmac.compare_digest(key.hex(), key_hex)
    except Exception:
        return False

def create_jwt_token(payload: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    header_json = json.dumps(header, separators=(",", ":")).encode("utf-8")
    header_b64 = _b64encode(header_json)

    exp = datetime.utcnow() + (expires_delta or timedelta(hours=JWT_EXPIRATION_HOURS))
    payload["exp"] = int(exp.timestamp())
    payload["iat"] = int(datetime.utcnow().timestamp())
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = _b64encode(payload_json)

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    secret = get_jwt_secret().encode("utf-8")
    signature = hmac.new(secret, signing_input, hashlib.sha256).digest()
    sig_b64 = _b64encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"

def create_access_token(
    user_id: str,
    email: str,
    is_superadmin: bool = False,
    org_roles: Optional[Dict[str, str]] = None,
    token_version: int = 1,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Creates an access token. Note that role and superadmin claims embedded here
    are non-authoritative and will be verified dynamically against the database on every request.
    """
    payload = {
        "sub": user_id,
        "email": email,
        "is_superadmin": is_superadmin,
        "org_roles": org_roles or {},
        "ver": token_version,
    }
    return create_jwt_token(payload, expires_delta=expires_delta)

def decode_jwt_token(token: str) -> Dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token format")
    header_b64, payload_b64, sig_b64 = parts

    try:
        header_json = _b64decode(header_b64)
        header = json.loads(header_json.decode("utf-8"))
    except Exception:
        raise ValueError("Invalid token header format")

    if not isinstance(header, dict) or header.get("alg") != JWT_ALGORITHM:
        raise ValueError(f"Algorithm confusion rejected: algorithm '{header.get('alg')}' is not supported")

    if header.get("typ") != "JWT":
        raise ValueError(f"Invalid token type '{header.get('typ')}'")

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    secret = get_jwt_secret().encode("utf-8")
    expected_sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    try:
        actual_sig = _b64decode(sig_b64)
    except Exception:
        raise ValueError("Invalid signature encoding")

    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid token signature")

    payload_json = _b64decode(payload_b64)
    payload = json.loads(payload_json.decode("utf-8"))

    exp = payload.get("exp")
    if exp and datetime.utcnow().timestamp() > exp:
        raise ValueError("Token has expired")

    return payload

def revoke_user_tokens(db: Session, user_id: str) -> int:
    """
    Invalidates all outstanding tokens for a user by incrementing their token_version.
    """
    from backend.app.models.auth import UserModel
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")
    user.token_version += 1
    db.commit()
    db.refresh(user)
    return user.token_version

@dataclass
class UserContext:
    user_id: str
    email: str
    is_superadmin: bool
    org_roles: Dict[str, str]

    def has_role(self, organization_id: str, required_role: str) -> bool:
        if self.is_superadmin:
            return True
        return self.org_roles.get(organization_id) == required_role

    def has_permission(self, organization_id: str, permission: str) -> bool:
        if self.is_superadmin:
            return True
        user_role = self.org_roles.get(organization_id)
        if not user_role:
            return False
        allowed_permissions = ROLE_PERMISSIONS.get(user_role, [])
        return permission in allowed_permissions

def get_current_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: Session = Depends(get_db),
) -> UserContext:
    """
    Validates bearer token and resolves trusted server-side user identity and authorization.
    Never trusts client JWT claims for superadmin status or organization roles.
    Immediately rejects inactive, deleted, or revoked sessions.
    """
    if not auth or not auth.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_jwt_token(auth.credentials)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired authentication token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject identity claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Load user from database
    from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User does not exist or has been deleted",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Check active status
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account has been deactivated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Check token version revocation
    token_ver = payload.get("ver")
    current_token_version = getattr(user, "token_version", 1)
    if token_ver is None or token_ver < current_token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked or invalidated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 4. Resolve platform superadmin clearance exclusively from authoritative database record
    # Never trust JWT is_superadmin claim
    authoritative_superadmin = bool(user.is_superadmin)

    # 5. Resolve organization memberships and roles exclusively from authoritative database records
    # Never trust JWT org_roles claim
    memberships = (
        db.query(OrganizationMemberModel)
        .join(OrganizationModel, OrganizationMemberModel.organization_id == OrganizationModel.id)
        .filter(
            OrganizationMemberModel.user_id == user.id,
            OrganizationModel.is_active == True,
        )
        .all()
    )
    authoritative_org_roles = {m.organization_id: m.role for m in memberships}

    return UserContext(
        user_id=user.id,
        email=user.email,
        is_superadmin=authoritative_superadmin,
        org_roles=authoritative_org_roles,
    )

def get_current_tenant_org(
    user: UserContext = Depends(get_current_user),
    organization_id: Optional[str] = Query(None, description="Explicit target organization"),
    header_org_id: Optional[str] = Header(None, alias="X-Organization-Id"),
) -> str:
    """
    Resolves trusted server-side tenant organization scope.
    Never trusts client input without verifying authenticated organization membership.
    """
    target_org = organization_id or header_org_id

    # If superadmin, allow accessing requested organization or default
    if user.is_superadmin:
        return target_org or "org_default_company"

    # User must have at least one membership
    if not user.org_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not belong to any organization",
        )

    # If specific organization requested, verify membership
    if target_org:
        if target_org not in user.org_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: You do not have access to organization '{target_org}'",
            )
        return target_org

    # Fallback to user's first/primary organization
    return next(iter(user.org_roles.keys()))

def require_permission(permission: str):
    """
    Dependency factory verifying that authenticated caller has the specified permission in the active tenant.
    """
    def _permission_guard(
        user: UserContext = Depends(get_current_user),
        tenant_org: str = Depends(get_current_tenant_org),
    ) -> str:
        if not user.has_permission(tenant_org, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: Action requires '{permission}' clearance in organization '{tenant_org}'",
            )
        return tenant_org
    return _permission_guard

def require_platform_superadmin(
    user: UserContext = Depends(get_current_user),
) -> UserContext:
    """
    Dependency enforcing platform superadmin privileges for global catalog mutations.
    """
    if not user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Platform Superadmin clearance required for this operation",
        )
    return user
