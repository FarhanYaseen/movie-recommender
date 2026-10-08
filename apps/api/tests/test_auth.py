# tests/test_auth.py

from datetime import datetime, timedelta, timezone

import jwt

from tests.conftest import login


def test_login_success(client, user_a):
    headers = login(client, "alice@test.local")
    assert headers["Authorization"].startswith("Bearer ")


def test_login_wrong_password(client, user_a):
    response = client.post(
        "/api/auth/login", json={"email": "alice@test.local", "password": "wrong"}
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "UNAUTHORIZED"
    assert body["error"]["request_id"].startswith("req_")


def test_login_unknown_user(client):
    response = client.post(
        "/api/auth/login", json={"email": "nobody@test.local", "password": "whatever"}
    )
    assert response.status_code == 401


def test_protected_route_requires_token(client):
    response = client.get("/api/documents")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_expired_token_rejected(client, user_a):
    expired = jwt.encode(
        {
            "sub": str(user_a.id),
            "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
        },
        "test-secret-0123456789-0123456789-0123",
        algorithm="HS256",
    )
    response = client.get("/api/documents", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_garbage_token_rejected(client):
    response = client.get("/api/documents", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_validation_error_shape_is_400(client):
    # Contract: FastAPI validation errors normalize to 400 + error shape
    response = client.post("/api/auth/login", json={"email": "x"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_health_endpoints(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ready"}
