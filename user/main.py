import os
import asyncio

import requests
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from models import User, Base, Followings
from schemas import UserInDB, UserCreate, FollowCreate, FollowResponse
from schemas import UnfollowCreate, FollowingsResponse, FollowersResponse


# Database Connection Settings
DB_HOST = os.getenv('DB_HOST') or 'localhost'
DB_PORT = os.getenv('DB_PORT') or '5432'
DATABASE_URL = f"postgresql://root:toor@{DB_HOST}:{DB_PORT}/userdb"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Service Discovery Connection Settings
SERVICE_DISCOVERY_HOST = os.getenv('SERVICE_DISCOVERY_HOST') or 'localhost'
SERVICE_DISCOVERY_PORT = os.getenv('SERVICE_DISCOVERY_PORT') or '8040'
SERVICE_DISCOVERY_URL = f"http://{SERVICE_DISCOVERY_HOST}:{SERVICE_DISCOVERY_PORT}"


# Self Settings
SELF_HOST = os.getenv('HOSTNAME') or 'localhost'
SELF_PORT = os.getenv('SELF_PORT') or '8000'


TIMEOUT_SECONDS = 5

app = FastAPI()


@app.on_event("startup")
async def startup_event():
    url = f"{SERVICE_DISCOVERY_URL}/services"
    data = {
        "serviceHost": SELF_HOST,
        "servicePort": SELF_PORT,
        "serviceType": "user"
    }

    response = requests.post(url, json=data)

    if response.status_code != 200:
        raise Exception(f"Failed to register with service discovery: {response.text}")


@app.middleware("http")
async def timeout_middleware(request, call_next):
    try:
        # Call the next middleware/route handler with a timeout
        response = await asyncio.wait_for(call_next(request), timeout=TIMEOUT_SECONDS)
        return response
    except asyncio.TimeoutError:
        return JSONResponse(status_code=408, content={"error": "Request timed out"})


@app.get("/users/timeout")
def timeout():
    import time
    time.sleep(TIMEOUT_SECONDS + 1)
    return {"status": "OK"}


@app.get("/status")
def read_status():
    return {"status": "OK"}


@app.post("/users/register", response_model=UserInDB)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(
            status_code=400, detail="Username already registered"
        )
    new_user = User(username=user.username, password=user.password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.post("/users/{userId}/follow", response_model=FollowResponse)
def create_follow(userId: int, follow: FollowCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == userId).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    follow_user = db.query(User).filter(User.id == follow.followUserId).first()
    if not follow_user:
        raise HTTPException(status_code=404, detail="User to follow not found")

    new_follow = Followings(follower_id=userId, followed_id=follow_user.id)
    db.add(new_follow)
    db.commit()

    return {"message": f"User {user.username} is now following {follow_user.username}"}


@app.delete("/users/{userId}/unfollow", response_model=FollowResponse)
def delete_follow(userId: int, unfollow: UnfollowCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == userId).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    unfollow_user = db.query(User).filter(
        User.id == unfollow.unfollowUserId
    ).first()
    if not unfollow_user:
        raise HTTPException(
            status_code=404,
            detail="User to unfollow not found"
        )

    follow = db.query(Followings).filter(
        Followings.follower_id == userId,
        Followings.followed_id == unfollow_user.id
    ).first()
    if not follow:
        raise HTTPException(status_code=404, detail="No follow found")

    db.delete(follow)
    db.commit()

    return {"message": f"User {user.username} is no longer following {unfollow_user.username}"}


@app.get("/users/{userId}/followings", response_model=FollowingsResponse)
def get_followings(userId: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == userId).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    followings = db.query(Followings).filter(
        Followings.follower_id == userId).all()
    followings_ids = [following.followed_id for following in followings]

    return {"followings": followings_ids}


@app.get("/users/{userId}/followers", response_model=FollowersResponse)
def get_followers(userId: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == userId).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    followers = db.query(Followings).filter(
        Followings.followed_id == userId).all()
    followers_ids = [follower.follower_id for follower in followers]

    return {"followers": followers_ids}


import uuid
sessions = {}


@app.delete("/users/{userId}/first")
def erase_user_first_phase(userId: int):
    session = SessionLocal()
    session.begin()
    user = session.query(User).filter(User.id == userId).first()

    if not user:
        session.commit()
        session.close()
        raise HTTPException(status_code=404, detail="User not found")
    
    session.delete(user)
    session_id = str(uuid.uuid4())
    sessions[session_id] = session

    return {"session": session_id}


@app.get("/users/sessions/{sessionId}/commit")
def erase_user_commit(sessionId: str):
    session = sessions.pop(sessionId, None)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session.commit()
    session.close()

    return {"message": f"Session {sessionId} committed successfully"}


@app.get("/users/sessions/{sessionId}/rollback")
def erase_user_rollback(sessionId: str):
    session = sessions.pop(sessionId, None)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session.rollback()
    session.close()

    return {"message": f"Session {sessionId} was rolled back"}


@app.get("/users/sessions")
def get_sessions():
    return {"sessions": list(sessions.keys())}
