import os
import asyncio

import requests
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from models import Tweet, Base
from schemas import TweetIn, TweetOut, Message, HomeTimeline, UserTimeline
from schemas import Tweet as schemasTweet


# Database Connection Settings
DB_HOST = os.getenv('DB_HOST') or 'localhost'
DB_PORT = os.getenv('DB_PORT') or '5432'
DATABASE_URL = f"postgresql://root:toor@{DB_HOST}:{DB_PORT}/tweetdb"

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
SELF_PORT = os.getenv('SELF_PORT') or '8001'
TIMEOUT_SECONDS = 5

app = FastAPI()


@app.on_event("startup")
async def startup_event():
    url = f"{SERVICE_DISCOVERY_URL}/services"
    data = {
        "serviceHost": SELF_HOST,
        "servicePort": SELF_PORT,
        "serviceType": "tweet"
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


status_codes = {}


@app.middleware("http")
async def update_metrics(request, call_next):
    response = await call_next(request)
    status_code = response.status_code
    
    if status_code in status_codes:
        status_codes[status_code] += 1
    else:
        status_codes[status_code] = 1

    return response


@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    list = [
        '# HELP http_requests_total The total number of HTTP requests.',
        '# TYPE http_requests_total counter'
    ]

    if len(status_codes) == 0:
        status_codes[200] = 0

    for status_code, counter in status_codes.items():
        list.append(f'http_requests_total{{code="{status_code}"}} {counter}')

    return '\n'.join(list)


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
    # Get service discovery data
    service_discovery_response = requests.get(f"{SERVICE_DISCOVERY_URL}/services")
    service_discovery_data = service_discovery_response.json()

    # Extract userServices and construct USERSERVICE_URL
    user_services = service_discovery_data.get('userServices', [])
    if not user_services:
        raise HTTPException(status_code=400, detail="No user services available.")
    
    first_user_service = user_services[0]
    userservice_url = f"http://{first_user_service['host']}:{first_user_service['port']}"
    
    # Fetch followings
    response = requests.get(f"{userservice_url}/users/{userId}/followings")

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


import uuid
sessions = {}


@app.delete("/tweets/users/{userId}/first")
def erase_user_tweets_first_phase(userId: int):
    session = SessionLocal()
    session.begin()
    
    session.query(Tweet).filter(Tweet.user_id == userId).delete()

    session_id = str(uuid.uuid4())
    sessions[session_id] = session

    return {"session": session_id}


@app.get("/tweets/sessions/{sessionId}/commit")
def erase_user_tweets_commit(sessionId: str):
    session = sessions.pop(sessionId, None)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session.commit()
    session.close()

    return {"message": f"Session {sessionId} committed successfully"}


@app.get("/tweets/sessions/{sessionId}/rollback")
def erase_user_tweets_rollback(sessionId: str):
    session = sessions.pop(sessionId, None)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session.rollback()
    session.close()

    return {"message": f"Session {sessionId} was rolled back"}


@app.get("/tweets/sessions")
def get_sessions():
    return {"sessions": list(sessions.keys())}
