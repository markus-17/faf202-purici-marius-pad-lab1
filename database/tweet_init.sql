-- Create a database if it doesn't exist
CREATE DATABASE tweetdb;

-- Switch to the database
\c tweetdb;

-- Create a tweets table
CREATE TABLE IF NOT EXISTS tweets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    content VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- Insert some data into the tables
INSERT INTO 
    tweets (user_id, content)
VALUES 
    (1, 'Hello, Twitterverse! This is my first tweet.'),
    (1, 'Enjoying a beautiful sunset. #blessed'),
    (1, 'Just had the best cup of coffee. #coffeelover'),
    (2, 'Hello there! Excited to join the Twitter community.'),
    (2, 'Reading a fascinating book about space exploration. #bookworm'),
    (2, 'Spent the day hiking in nature. #outdoorlife'),
    (3, 'Greetings, tweeps! Ready to share my thoughts.'),
    (3, 'Baking some delicious cookies. #bakingfun'),
    (3, 'Watching a thrilling movie tonight. #movienight'),
    (4, 'Hey Twitter! Heres to my first tweet.'),
    (4, 'Working on a new painting. #artisticmood'),
    (4, 'Going for a long drive. #roadtrip');
