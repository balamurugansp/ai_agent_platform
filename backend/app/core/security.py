"""
ARB-001: JWT Bearer + API Key authentication.

Usage:
  - POST /api/v1/auth/token  { username, password }  → access_token
  - All protected routes: Authorization: Bearer <token>
  - Or: X-API-Key: <api_key>

Dev defaults (override via .env):
  ADMIN_USERNAME=admin
  ADMIN_PASSWORD=changeme
  API_KEYS=key1,key2
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Crypto helpers ────────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire, "iat": datetime.now(timezone.utc)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# ── In-memory user store (replace with DB in production) ─────────────────────
def _build_user_store() -> dict:
    return {
        settings.ADMIN_USERNAME: {
            "username": settings.ADMIN_USERNAME,
            "hashed_password": hash_password(settings.ADMIN_PASSWORD),
            "role": "admin",
        }
    }


_USERS: Optional[dict] = None


def get_user_store() -> dict:
    global _USERS
    if _USERS is None:
        _USERS = _build_user_store()
    return _USERS


def authenticate_user(username: str, password: str) -> Optional[dict]:
    users = get_user_store()
    user = users.get(username)
    if not user:
        return None
    if not verify_password(password, user["hashed_password"]):
        return None
    return user


# ── API Key validation ────────────────────────────────────────────────────────
def _valid_api_keys() -> set:
    raw = settings.API_KEYS or ""
    return {k.strip() for k in raw.split(",") if k.strip()}


# ── Dependency: get current user ─────────────────────────────────────────────
class CurrentUser(BaseModel):
    username: str
    role: str = "user"


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    api_key: Optional[str] = Security(api_key_header),
) -> CurrentUser:
    # Try API Key first
    if api_key and api_key in _valid_api_keys():
        return CurrentUser(username="api-key-user", role="api")

    # Try JWT Bearer
    if token:
        subject = decode_token(token)
        if subject:
            users = get_user_store()
            user = users.get(subject)
            if user:
                return CurrentUser(username=user["username"], role=user["role"])

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated. Provide a valid Bearer token or X-API-Key header.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin role required.")
    return current_user


# ── Token response schema ─────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenRequest(BaseModel):
    username: str
    password: str
