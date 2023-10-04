from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from models import User, Base, Followings
from schemas import UserInDB, UserCreate, FollowCreate, FollowResponse, UnfollowCreate, FollowingsResponse, FollowersResponse

DATABASE_URL = "postgresql://root:toor@localhost:5432/userdb"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

app = FastAPI()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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
