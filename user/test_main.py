import os
import json

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app, get_db
from models import Base, User, Followings


# Delete the previous test.db file in case it exists
if os.path.exists("test.db"):
    os.remove("test.db")


# Set up the test database and session
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)


# Dependency override for get_db
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db


# Create test client and define tests
client = TestClient(app)

def test_read_status():
    response = client.get("/status")
    assert response.status_code == 200
    assert response.json() == {"status": "OK"}


def test_create_user():
    response = client.post("/users/register", json={"username": "testuser", "password": "testpassword"})
    assert response.status_code == 200
    user = response.json()
    assert user["username"] == "testuser"
    assert user["password"] == "testpassword"


def test_create_follow():
    # First, create two users
    response = client.post("/users/register", json={"username": "testuser1", "password": "testpassword"})
    assert response.status_code == 200
    user1 = response.json()

    response = client.post("/users/register", json={"username": "testuser2", "password": "testpassword"})
    assert response.status_code == 200
    user2 = response.json()

    # Then, make testuser1 follow testuser2
    response = client.post(f"/users/{user1['id']}/follow", json={"followUserId": user2['id']})
    assert response.status_code == 200
    assert response.json() == {"message": f"User {user1['username']} is now following {user2['username']}"}


def test_delete_follow():
    # First, create two users
    response = client.post("/users/register", json={"username": "testuser3", "password": "testpassword"})
    assert response.status_code == 200
    user1 = response.json()

    response = client.post("/users/register", json={"username": "testuser4", "password": "testpassword"})
    assert response.status_code == 200
    user2 = response.json()

    # Then, make testuser1 follow testuser2
    response = client.post(f"/users/{user1['id']}/follow", json={"followUserId": user2['id']})
    assert response.status_code == 200

    # Finally, make testuser1 unfollow testuser2
    response = client.request(
        method='DELETE',
        url=f"/users/{user1['id']}/unfollow", 
        json={"unfollowUserId": user2['id']}
    )
    assert response.status_code == 200
    assert response.json() == {"message": f"User {user1['username']} is no longer following {user2['username']}"}


def test_get_followings():
    # First, create two users
    response = client.post("/users/register", json={"username": "testuser5", "password": "testpassword"})
    assert response.status_code == 200
    user1 = response.json()

    response = client.post("/users/register", json={"username": "testuser6", "password": "testpassword"})
    assert response.status_code == 200
    user2 = response.json()

    # Then, make testuser1 follow testuser2
    response = client.post(f"/users/{user1['id']}/follow", json={"followUserId": user2['id']})
    assert response.status_code == 200

    # Finally, get the list of users that testuser1 is following
    response = client.get(f"/users/{user1['id']}/followings")
    assert response.status_code == 200
    assert response.json() == {"followings": [user2['id']]}


def test_get_followers():
    # First, create two users
    response = client.post("/users/register", json={"username": "testuser7", "password": "testpassword"})
    assert response.status_code == 200
    user1 = response.json()

    response = client.post("/users/register", json={"username": "testuser8", "password": "testpassword"})
    assert response.status_code == 200
    user2 = response.json()

    # Then, make testuser2 follow testuser1
    response = client.post(f"/users/{user2['id']}/follow", json={"followUserId": user1['id']})
    assert response.status_code == 200

    # Finally, get the list of users that are following testuser1
    response = client.get(f"/users/{user1['id']}/followers")
    assert response.status_code == 200
    assert response.json() == {"followers": [user2['id']]}
