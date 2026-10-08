# app/auth.py
# Password hashing + expiring JWT access tokens + current-user dependency.
# Credentials and tokens are never logged.

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import UnauthorizedError
from .models import User

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd.verify(password, password_hash)


def create_access_token(user: User) -> tuple[str, int]:
    settings = get_settings()
    expires_in = settings.jwt_expires_min * 60
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, expires_in


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError()
    settings = get_settings()
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise UnauthorizedError("Token has expired")
    except jwt.InvalidTokenError:
        raise UnauthorizedError("Invalid token")

    try:
        user_id = uuid.UUID(payload.get("sub", ""))
    except ValueError:
        raise UnauthorizedError("Invalid token")

    user = db.get(User, user_id)
    if user is None:
        raise UnauthorizedError("Unknown user")
    return user


def seed_demo_users(db: Session) -> None:
    """Create the two local demo users when ENABLE_DEMO_SEED=true and passwords are set."""
    settings = get_settings()
    if not settings.enable_demo_seed:
        return
    for email, password in [
        (settings.demo_user_a_email, settings.demo_user_a_password),
        (settings.demo_user_b_email, settings.demo_user_b_password),
    ]:
        if not email or not password:
            continue
        email = email.strip().lower()
        existing = db.query(User).filter(User.email == email).one_or_none()
        if existing is None:
            db.add(User(email=email, password_hash=hash_password(password)))
    db.commit()
