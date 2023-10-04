from datetime import datetime
from pydantic import BaseModel


class TweetIn(BaseModel):
    userId: int
    content: str


class TweetOut(BaseModel):
    tweetId: int
    userId: int
    content: str
    timestamp: str


class Message(BaseModel):
    message: str


class Tweet(BaseModel):
    id: int
    user_id: int
    content: str
    created_at: datetime


class HomeTimeline(BaseModel):
    tweets: list[Tweet]


class UserTimeline(BaseModel):
    tweets: list[Tweet]
