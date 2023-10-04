-- Create a database if it doesn't exist
CREATE DATABASE userdb;

-- Switch to the database
\c userdb;

-- Create a users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(50) NOT NULL
);

-- Create a followings table
CREATE TABLE followings (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER REFERENCES users(id),
    followed_id INTEGER REFERENCES users(id)
);

-- Insert some data into the tables
INSERT INTO
    users (username, password)
VALUES
    ('marius.purici', 'password1'),
    ('john.cena', 'password2'),
    ('elon.musk', 'password3'),
    ('bill.gates', 'password4');


INSERT INTO 
    followings (follower_id, followed_id)
VALUES
    (1, 3),
    (1, 4),
    (4, 3),
    (3, 4);
