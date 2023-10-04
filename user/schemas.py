from typing import List

from pydantic import BaseModel


class UserBase(BaseModel):
    username: str
    password: str


class UserInDB(UserBase):
    id: int


class UserCreate(UserBase):
    pass


class FollowCreate(BaseModel):
    followUserId: int


class FollowResponse(BaseModel):
    message: str


class UnfollowCreate(BaseModel):
    unfollowUserId: int


class FollowingsResponse(BaseModel):
    followings: List[int]


class FollowersResponse(BaseModel):
    followers: List[int]
