import os
import asyncio

import requests
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from models import Tweet, Base
from schemas import TweetIn, TweetOut, Message, HomeTimeline, UserTimeline
from schemas import Tweet as schemasTweet

DB_HOST = os.getenv('DB_HOST') or 'localhost'
DB_PORT = os.getenv('DB_PORT') or '5432'
DATABASE_URL = f"postgresql://root:toor@{DB_HOST}:{DB_PORT}/tweetdb"
USERSERVICE_URL = 'http://localhost:8000'

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


TIMEOUT_SECONDS = 5


@app.middleware("http")
async def timeout_middleware(request, call_next):
    try:
        # Call the next middleware/route handler with a timeout
        response = await asyncio.wait_for(call_next(request), timeout=TIMEOUT_SECONDS)
        return response
    except asyncio.TimeoutError:
        return JSONResponse(status_code=408, content={"error": "Request timed out"})


@app.get("/tweets/timeout")
def timeout():
    import time
    time.sleep(TIMEOUT_SECONDS + 1)
    return {"status": "OK"}


@app.get("/status")
def read_status():
    return {"status": "OK"}


@app.post("/tweets", response_model=TweetOut)
def create_tweet(tweet: TweetIn, db: Session = Depends(get_db)):
    new_tweet = Tweet(user_id=tweet.userId, content=tweet.content)
    db.add(new_tweet)
    db.commit()
    db.refresh(new_tweet)

    return TweetOut(
        tweetId=new_tweet.id,
        userId=new_tweet.user_id,
        content=new_tweet.content,
        timestamp=str(new_tweet.created_at)
    )


@app.delete("/tweets/{tweetId}", response_model=Message)
def delete_tweet(tweetId: int, db: Session = Depends(get_db)):
    tweet = db.query(Tweet).get(tweetId)
    if not tweet:
        raise HTTPException(status_code=404, detail="Tweet not found")

    db.delete(tweet)
    db.commit()

    return Message(message=f"Tweet {tweetId} has been deleted successfully.")


@app.get("/tweets/homeTimeline/{userId}", response_model=HomeTimeline)
def get_home_timeline(userId: int, db: Session = Depends(get_db)):
    response = requests.get(f"{USERSERVICE_URL}/users/{userId}/followings")

    if response.status_code != 200:
        raise HTTPException(
            status_code=400, detail="Error occurred while fetching followings."
        )

    followings = response.json()['followings']
    tweets = db.query(Tweet).filter(Tweet.user_id.in_(followings)).all()
    tweets = [schemasTweet(
        id=tweet.id,
        user_id=tweet.user_id,
        content=tweet.content,
        created_at=tweet.created_at
    ) for tweet in tweets]

    return HomeTimeline(tweets=tweets)


@app.get("/tweets/userTimeline/{userId}", response_model=UserTimeline)
def get_user_timeline(userId: int, db: Session = Depends(get_db)):
    tweets = db.query(Tweet).filter(Tweet.user_id == userId).all()
    tweets = [schemasTweet(
        id=tweet.id,
        user_id=tweet.user_id,
        content=tweet.content,
        created_at=tweet.created_at
    ) for tweet in tweets]
    return UserTimeline(tweets=tweets)
