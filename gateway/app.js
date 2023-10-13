import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import redis from 'redis';

const app = express();
const port = 8002;
const userService = 'http://localhost:8000';
const tweetService = 'http://localhost:8001';

app.use(bodyParser.json());


const redisClient = redis.createClient();
redisClient.on('error', (err) => { console.log('Error connecting to Redis:', err); });
redisClient.on('connect', () => { console.log('Connected to Redis'); });
redisClient.on('ready', () => { console.log('Redis client is ready'); });
redisClient.on('reconnecting', () => { console.log('Redis client is reconnecting'); });
process.on('exit', () => { redisClient.quit(); });
await redisClient.connect();


// Swagger setup
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Express API with Swagger',
            version: '1.0.0',
        },
    },
    // Path to the API docs
    apis: ['./app.js'], // files containing annotations as above
};


const specs = swaggerJsdoc(options);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));


const LIMIT = 3;
const WINDOW_MS = 10 * 1000; // 10 seconds
let requestsDateTime = [];

app.use((req, res, next) => {
    let currentDateTime = Date.now();
    requestsDateTime = requestsDateTime.filter(dateTime => (currentDateTime - dateTime) <= WINDOW_MS);

    if(requestsDateTime.length >= LIMIT) {
        console.log(`rateLimiterMiddleware: 429 ${currentDateTime} [${requestsDateTime}]`);
        res.status(429).send({
            'message': 'Too many requests, please try again after some time.'
        });
        return;
    }
    
    requestsDateTime.push(currentDateTime);
    console.log(`rateLimiterMiddleware: ${currentDateTime} [${requestsDateTime}]`);
    next();
});


app.get('/users/timeout', async (req, res) => {
    try {
        const response = await axios.get(`${userService}/users/timeout`, req.body);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


app.get('/tweets/timeout', async (req, res) => {
    try {
        const response = await axios.get(`${tweetService}/tweets/timeout`, req.body);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /users/register:
 *   post:
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: The user was successfully registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 username:
 *                   type: string
 *                 password:
 *                   type: string
 *       400:
 *         description: Username already registered
 */
app.post('/users/register', async (req, res) => {
    try {
        const response = await axios.post(`${userService}/users/register`, req.body);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /users/{userId}/follow:
 *   post:
 *     summary: Follow a user
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the user to follow
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               followUserId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: The user was successfully followed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: User not found or User to follow not found
 */
app.post('/users/:userId/follow', async (req, res) => {
    try {
        const response = await axios.post(`${userService}/users/${req.params.userId}/follow`, req.body);
        res.json(response.data);
        await redisClient.set(`/users/${req.params.userId}/followings`, '');
        if(req.body.followUserId !== null) {
            await redisClient.set(`/users/${req.body.followUserId}/followers`, '');
        }
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /users/{userId}/unfollow:
 *   delete:
 *     summary: Unfollow a user
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the user to unfollow
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               unfollowUserId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: The user was successfully unfollowed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: User not found, User to unfollow not found, or No follow found
 */
app.delete('/users/:userId/unfollow', async (req, res) => {
    try {
        const response = await axios.delete(`${userService}/users/${req.params.userId}/unfollow`, { data: req.body });
        res.json(response.data);
        await redisClient.set(`/users/${req.params.userId}/followings`, '');
        if(req.body.unfollowUserId !== null) {
            await redisClient.set(`/users/${req.body.unfollowUserId}/followers`, '');
        }
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /users/{userId}/followings:
 *   get:
 *     summary: Retrieve a list of followings by user ID
 *     description: Retrieve a list of followings by user ID. If the user does not exist, it will return a 404 error.
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the user to get the followings for.
 *     responses:
 *       200:
 *         description: A list of followings by the user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 followings:
 *                   type: array
 *                   items:
 *                     type: integer
 *       404:
 *         description: User not found.
 */
app.get('/users/:userId/followings', async (req, res) => {
    const response = await redisClient.get(`/users/${req.params.userId}/followings`)
    if(response) {
        res.set({'X-Cache': 'HIT'}).json(JSON.parse(response));
        return
    }

    try {
        const response = await axios.get(`${userService}/users/${req.params.userId}/followings`);
        res.set({'X-Cache': 'MISS'}).json(response.data);
        await redisClient.set(`/users/${req.params.userId}/followings`, JSON.stringify(response.data));
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /users/{userId}/followers:
 *   get:
 *     summary: Retrieve a list of followers by user ID
 *     description: Retrieve a list of followers by user ID. If the user does not exist, it will return a 404 error.
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the user to get the followers for.
 *     responses:
 *       200:
 *         description: A list of followers of the user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 followers:
 *                   type: array
 *                   items:
 *                     type: integer
 *       404:
 *         description: User not found.
 */
app.get('/users/:userId/followers', async (req, res) => {
    const response = await redisClient.get(`/users/${req.params.userId}/followers`)
    if(response) {
        res.set({'X-Cache': 'HIT'}).json(JSON.parse(response));
        return
    }

    try {
        const response = await axios.get(`${userService}/users/${req.params.userId}/followers`);
        res.set({'X-Cache': 'MISS'}).json(response.data);
        await redisClient.set(`/users/${req.params.userId}/followers`, JSON.stringify(response.data));
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /tweets:
 *   post:
 *     summary: Create a new tweet
 *     description: Create a new tweet. The tweet will be linked to the user ID provided in the request body.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: The ID of the user who is creating the tweet.
 *               content:
 *                 type: string
 *                 description: The content of the tweet.
 *     responses:
 *       200:
 *         description: The created tweet.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tweetId:
 *                   type: integer
 *                   description: The ID of the created tweet.
 *                 userId:
 *                   type: integer
 *                   description: The ID of the user who created the tweet.
 *                 content:
 *                   type: string
 *                   description: The content of the created tweet.
 *                 timestamp:
 *                   type: string
 *                   description: The timestamp when the tweet was created.
 */
app.post('/tweets', async (req, res) => {
    try {
        const response = await axios.post(`${tweetService}/tweets`, req.body);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /tweets/{tweetId}:
 *   delete:
 *     summary: Delete a tweet by ID
 *     description: Delete a tweet by ID. If the tweet does not exist, it will return a 404 error.
 *     parameters:
 *       - in: path
 *         name: tweetId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the tweet to delete.
 *     responses:
 *       200:
 *         description: A message indicating the tweet has been deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Tweet not found.
 */
app.delete('/tweets/:tweetId', async (req, res) => {
    try {
        const response = await axios.delete(`${tweetService}/tweets/${req.params.tweetId}`);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /tweets/homeTimeline/{userId}:
 *   get:
 *     summary: Retrieve the home timeline by user ID
 *     description: Retrieve the home timeline by user ID. The home timeline includes tweets from the users that the given user follows. If an error occurs while fetching followings, it will return a 400 error.
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the user to get the home timeline for.
 *     responses:
 *       200:
 *         description: The home timeline of the user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tweets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: The ID of the tweet.
 *                       user_id:
 *                         type: integer
 *                         description: The ID of the user who created the tweet.
 *                       content:
 *                         type: string
 *                         description: The content of the tweet.
 *                       created_at:
 *                         type: string
 *                         description: The timestamp when the tweet was created.
 *       400:
 *         description: Error occurred while fetching followings.
 */
app.get('/tweets/homeTimeline/:userId', async (req, res) => {
    try {
        const response = await axios.get(`${tweetService}/tweets/homeTimeline/${req.params.userId}`);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


/**
 * @swagger
 * /tweets/userTimeline/{userId}:
 *   get:
 *     summary: Retrieve the user timeline by user ID
 *     description: Retrieve the user timeline by user ID. The user timeline includes tweets from the given user.
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Numeric ID of the user to get the user timeline for.
 *     responses:
 *       200:
 *         description: The user timeline of the user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tweets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: The ID of the tweet.
 *                       user_id:
 *                         type: integer
 *                         description: The ID of the user who created the tweet.
 *                       content:
 *                         type: string
 *                         description: The content of the tweet.
 *                       created_at:
 *                         type: string
 *                         description: The timestamp when the tweet was created.
 */
app.get('/tweets/userTimeline/:userId', async (req, res) => {
    try {
        const response = await axios.get(`${tweetService}/tweets/userTimeline/${req.params.userId}`);
        res.json(response.data);
    } catch (error) {
        res.status(error.response.status).json(error.response.data);
    }
});


// Start the gateway server
app.listen(port, () => console.log(`Gateway running on port ${port}`));
