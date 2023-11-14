import express from 'express'
import axios from 'axios'
import bodyParser from 'body-parser'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import redis from 'redis'

const app = express()
const port = 8030

// Metrics endpoint and helper functions for Prometheus
const statusCodes = new Map()

function increaseStatusCodes (statusCode) {
  if (statusCodes.get(statusCode) === undefined) {
    statusCodes.set(statusCode, 0)
  }

  statusCodes.set(statusCode, statusCodes.get(statusCode) + 1)
}

function retrieveMetricsText () {
  const array = [
    '# HELP http_requests_total The total number of HTTP requests.',
    '# TYPE http_requests_total counter'
  ]

  if (statusCodes.size === 0) {
    statusCodes.set(200, 0)
  }

  const keys = statusCodes.keys()

  for (const key of keys) {
    array.push(`http_requests_total{code="${key}"} ${statusCodes.get(key)}`)
  }

  return array.join('\n')
}

app.use((req, res, next) => {
  res.on('finish', () => increaseStatusCodes(res.statusCode))
  next()
})

app.get('/metrics', (req, res) => {
  res.status(200).send(retrieveMetricsText())
})

// Service Discovery Connection Settings
const serviceDiscoveryHost = process.env.SERVICE_DISCOVERY_HOST || 'localhost'
const serviceDiscoveryPort = process.env.SERVICE_DISCOVERY_PORT || '8040'
const serviceDiscoveryEndpoint = `http://${serviceDiscoveryHost}:${serviceDiscoveryPort}/services`

// The following callService function implements load balancing logic and
// also circuit breaker requirements logic from the first and second lab
let userServiceCounter = 0
let tweetServiceCounter = 0
const MAX_REROUTES = 3
const TASK_TIMEOUT_MS = (process.env.TASK_TIMEOUT ? parseInt(process.env.TASK_TIMEOUT) : 10) * 1000
async function callService (serviceType, requestMethod, requestUrl, reqBody) {
  const serviceDiscoveryResponse = await axios.get(serviceDiscoveryEndpoint)
  const userServices = serviceDiscoveryResponse.data.userServices
  const tweetServices = serviceDiscoveryResponse.data.tweetServices

  for (let i = 0; i < MAX_REROUTES; ++i) {
    userServiceCounter = userServiceCounter % userServices.length
    tweetServiceCounter = tweetServiceCounter % tweetServices.length

    let nextService
    if (serviceType === 'user') {
      nextService = userServices[userServiceCounter]
      userServiceCounter++
    } else if (serviceType === 'tweet') {
      nextService = tweetServices[tweetServiceCounter]
      tweetServiceCounter++
    }

    const { host, port } = nextService
    const nextServiceUrl = `http://${host}:${port}`

    try {
      console.log(`Attempting call to service of type ${serviceType} at ${nextServiceUrl}`)
      const serviceResponse = await axios({
        method: requestMethod,
        url: `${nextServiceUrl}/${requestUrl}`,
        data: reqBody
      })
      return { statusCode: 200, responseBody: serviceResponse.data, serviceUrl: nextServiceUrl }
    } catch (error) {
      if (error.code === 'ENOTFOUND') {
        console.log(`Failed to call service of type ${serviceType} at ${nextServiceUrl}`)
        circuitBreaker(serviceType, nextServiceUrl)
        continue
      } else {
        return { statusCode: error.response.status, responseBody: error.response.data }
      }
    }
  }

  return { statusCode: 500, responseBody: { message: `${serviceType} Service Call Failed` } }
}

function circuitBreaker (serviceType, serviceUrl) {
  setTimeout(async () => {
    const start = Date.now()
    let errors = 0

    while (true) {
      try {
        await axios({
          method: 'get',
          url: `${serviceUrl}/status`
        })
      } catch (error) {
        if (error.code === 'ENOTFOUND') {
          errors++

          if (errors >= 3 && Date.now() - start <= TASK_TIMEOUT_MS * 3.5) {
            console.log(`CIRCUIT BREAKER: Service of type ${serviceType} located at ${serviceUrl} is UNHEALTHY!!!`)
            return
          }

          continue
        }
      }

      break
    }
  }, 0)
}

app.use(bodyParser.json())

const redisHost = process.env.REDIS_HOST || 'localhost'
console.log(`Redis Host has been resolved to "${redisHost}"`)

const redisClient = redis.createClient({
  socket: {
    host: redisHost,
    port: 6379
  }
})

redisClient.on('error', (err) => { console.log('Error connecting to Redis:', err) })
redisClient.on('connect', () => { console.log('Connected to Redis') })
redisClient.on('ready', () => { console.log('Redis client is ready') })
redisClient.on('reconnecting', () => { console.log('Redis client is reconnecting') })
process.on('exit', () => { redisClient.quit() })
await redisClient.connect()

// Swagger setup
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Express API with Swagger',
      version: '1.0.0'
    }
  },
  // Path to the API docs
  apis: ['./app.js'] // files containing annotations as above
}

const specs = swaggerJsdoc(options)
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs))

// Status Endpoint for gateway
app.get('/status', (req, res) => {
  res.status(200).json({ status: 'OK' })
})

const LIMIT = process.env.RATE_LIMITER_LIMIT ? parseInt(process.env.RATE_LIMITER_LIMIT) : 3
const WINDOW_MS = (process.env.RATE_LIMITER_WINDOW_S ? parseInt(process.env.RATE_LIMITER_WINDOW_S) : 10) * 1000
let requestsDateTime = []

// Rate Limiter Middleware
app.use((req, res, next) => {
  const currentDateTime = Date.now()
  requestsDateTime = requestsDateTime.filter(dateTime => (currentDateTime - dateTime) <= WINDOW_MS)

  if (requestsDateTime.length >= LIMIT) {
    console.log(`rateLimiterMiddleware: 429 ${currentDateTime} [${requestsDateTime}]`)
    res.status(429).send({
      message: 'Too many requests, please try again after some time.'
    })
    return
  }

  requestsDateTime.push(currentDateTime)
  console.log(`rateLimiterMiddleware: ${currentDateTime} [${requestsDateTime}]`)
  next()
})

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
  const { statusCode, responseBody } = await callService('user', 'post', 'users/register', req.body)
  res.status(statusCode).json(responseBody)
})

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
  const { statusCode, responseBody } = await callService('user', 'post', `users/${req.params.userId}/follow`, req.body)
  res.status(statusCode).json(responseBody)

  if (statusCode === 200) {
    await redisClient.set(`/users/${req.params.userId}/followings`, '')
    if (req.body.followUserId !== null) {
      await redisClient.set(`/users/${req.body.followUserId}/followers`, '')
    }
  }
})

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
  const { statusCode, responseBody } = await callService('user', 'delete', `users/${req.params.userId}/unfollow`, req.body)
  res.status(statusCode).json(responseBody)

  if (statusCode === 200) {
    await redisClient.set(`/users/${req.params.userId}/followings`, '')
    if (req.body.unfollowUserId !== null) {
      await redisClient.set(`/users/${req.body.unfollowUserId}/followers`, '')
    }
  }
})

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
  if (response) {
    res.set({ 'X-Cache': 'HIT' }).json(JSON.parse(response))
    return
  }

  const { statusCode, responseBody } = await callService('user', 'get', `users/${req.params.userId}/followings`, req.body)
  res.set({ 'X-Cache': 'MISS' }).status(statusCode).json(responseBody)

  if (statusCode === 200) {
    await redisClient.set(`/users/${req.params.userId}/followings`, JSON.stringify(responseBody))
  }
})

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
  if (response) {
    res.set({ 'X-Cache': 'HIT' }).json(JSON.parse(response))
    return
  }

  const { statusCode, responseBody } = await callService('user', 'get', `users/${req.params.userId}/followers`, req.body)
  res.set({ 'X-Cache': 'MISS' }).status(statusCode).json(responseBody)

  if (statusCode === 200) {
    await redisClient.set(`/users/${req.params.userId}/followers`, JSON.stringify(responseBody))
  }
})

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
  const { statusCode, responseBody } = await callService('tweet', 'post', 'tweets', req.body)
  res.status(statusCode).json(responseBody)
})

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
  const { statusCode, responseBody } = await callService('tweet', 'delete', `tweets/${req.params.tweetId}`, req.body)
  res.status(statusCode).json(responseBody)
})

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
  const { statusCode, responseBody } = await callService('tweet', 'get', `tweets/homeTimeline/${req.params.userId}`, req.body)
  res.status(statusCode).json(responseBody)
})

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
  const { statusCode, responseBody } = await callService('tweet', 'get', `tweets/userTimeline/${req.params.userId}`, req.body)
  res.status(statusCode).json(responseBody)
})

/**
 * @swagger
 * /users/{userId}:
 *  delete:
 *    summary: Deletes a user and their tweets -- This is the endpoint which implements two phase commit --
 *    description: This endpoint deletes a user and all their tweets. It first calls the User Service to delete the user, then calls the Tweet Service to delete the user's tweets. If both operations are successful, it commits the changes.
 *    parameters:
 *      - in: path
 *        name: userId
 *        required: true
 *        description: The ID of the user to be deleted.
 *        schema:
 *          type: integer
 *    responses:
 *      '200':
 *        description: The user and their tweets were deleted successfully.
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                message:
 *                  type: string
 *                  example: "User 1 and their Tweets were deleted successfully"
 *      '500':
 *        description: An error occurred while deleting the user or their tweets.
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                message:
 *                  type: string
 *                  example: "Operation on User Service failed with Status Code 500"
 */
app.delete('/users/:userId', async (req, res) => {
  const userId = req.params.userId

  const callUserServiceResult = await callService('user', 'delete', `users/${userId}/first`, req.body)
  const { statusCode: userStatusCode } = callUserServiceResult

  if (userStatusCode !== 200) {
    res.status(500).json({ message: `Operation on User Service failed with Status Code ${userStatusCode}` })
    return
  }

  const { responseBody: userResponseBody, serviceUrl: userServiceUrl } = callUserServiceResult
  const { session: userSessionId } = userResponseBody

  const callTweetServiceResult = await callService('tweet', 'delete', `tweets/users/${userId}/first`, req.body)
  const { statusCode: tweetStatusCode } = callTweetServiceResult

  if (tweetStatusCode !== 200) {
    await axios.get(`${userServiceUrl}/users/sessions/${userSessionId}/rollback`)
    res.status(500).json({ message: `Operation on Tweet Service failed with Status Code ${tweetStatusCode}` })
    return
  }

  const { responseBody: tweetResponseBody, serviceUrl: tweetServiceUrl } = callTweetServiceResult
  const { session: tweetSessionId } = tweetResponseBody

  await axios.get(`${userServiceUrl}/users/sessions/${userSessionId}/commit`)
  await axios.get(`${tweetServiceUrl}/tweets/sessions/${tweetSessionId}/commit`)

  res.status(200).json({ message: `User ${userId} and their Tweets were deleted successfully` })
})

// Start the gateway server
app.listen(port, () => console.log(`Gateway running on port ${port}`))
