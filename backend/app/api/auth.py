"""
ARB-001: Authentication endpoints.

POST /api/v1/auth/token   — obtain JWT access token
GET  /api/v1/auth/me      — current user info
"""
from fastapi import APIRouter, HTTPException, status, Depends
from app.core.security import (
    authenticate_user, create_access_token,
    Token, TokenRequest, CurrentUser, get_current_user,
)
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/token", response_model=Token, summary="Obtain JWT access token")
async def login(body: TokenRequest):
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(subject=user["username"])
    return Token(
        access_token=token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=CurrentUser, summary="Get current user")
async def me(current_user: CurrentUser = Depends(get_current_user)):
    return current_user
