from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship, backref
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    password = Column(String(50))


class Followings(Base):
    __tablename__ = "followings"

    id = Column(Integer, primary_key=True)
    follower_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'))
    followed_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'))

    follower = relationship("User", backref=backref("followings_as_follower", cascade="all, delete-orphan"), foreign_keys=[follower_id])
    followed = relationship("User", backref=backref("followings_as_followed", cascade="all, delete-orphan"), foreign_keys=[followed_id])
