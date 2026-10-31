from typing import Dict, Any, List, Optional
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.core.auth import (
    verify_password,
    hash_password,
    create_jwt_token,
    get_current_user,
    UserContext,
)

router = APIRouter()

class LoginRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., description="User password")

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    full_name: str
    is_superadmin: bool
    org_roles: Dict[str, str]

@router.post("/login", response_model=LoginResponse)
def login(
    req: LoginRequest,
    db: Session = Depends(get_db),
):
    """
    Authenticate user credentials and issue signed JWT bearer token.
    """
    user = db.query(UserModel).filter(UserModel.email == req.email.lower().strip()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Load organization memberships
    memberships = (
        db.query(OrganizationMemberModel)
        .join(OrganizationModel, OrganizationMemberModel.organization_id == OrganizationModel.id)
        .filter(
            OrganizationMemberModel.user_id == user.id,
            OrganizationModel.is_active == True,
        )
        .all()
    )
    org_roles = {m.organization_id: m.role for m in memberships}

    token_payload = {
        "sub": user.id,
        "email": user.email,
        "is_superadmin": user.is_superadmin,
        "org_roles": org_roles,
        "ver": getattr(user, "token_version", 1),
    }
    access_token = create_jwt_token(token_payload)

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_superadmin=user.is_superadmin,
        org_roles=org_roles,
    )

@router.get("/me")
def get_current_user_profile(
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get profile and organization permissions for the authenticated user.
    """
    db_user = db.query(UserModel).filter(UserModel.id == user.user_id).first()
    return {
        "user_id": user.user_id,
        "email": user.email,
        "full_name": db_user.full_name if db_user else user.email,
        "is_superadmin": user.is_superadmin,
        "org_roles": user.org_roles,
    }
