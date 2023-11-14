import express from 'express'
import bodyParser from 'body-parser'

const app = express()
const port = 8040

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

const userServiceReplicas = []
const tweetServiceReplicas = []

app.use(bodyParser.json())

app.get('/status', (req, res) => {
  res.status(200).json({ status: 'OK' })
})

app.post('/services', (req, res) => {
  const { serviceType, serviceHost, servicePort } = req.body

  if (!serviceType || !serviceHost || !servicePort) {
    console.log(`Failed attempt to add service { host: ${serviceHost}, port: ${servicePort}, type: ${serviceType} }`)
    return res.status(400).send({ message: 'Missing required fields: serviceType, serviceHost, servicePort' })
  }

  const newService = { host: serviceHost, port: servicePort }

  if (serviceType === 'user') {
    if (!userServiceReplicas.some(el => el.host === newService.host && el.port === newService.port)) {
      userServiceReplicas.push(newService)
      console.log(`Service added successfully { host: ${serviceHost}, port: ${servicePort}, type: ${serviceType} }`)
    }
  } else if (serviceType === 'tweet') {
    if (!tweetServiceReplicas.some(el => el.host === newService.host && el.port === newService.port)) {
      tweetServiceReplicas.push(newService)
      console.log(`Service added successfully { host: ${serviceHost}, port: ${servicePort}, type: ${serviceType} }`)
    }
  } else {
    console.log(`Failed attempt to add service { host: ${serviceHost}, port: ${servicePort}, type: ${serviceType} }`)
    return res.status(400).send({ message: 'Invalid serviceType. Expected "user" or "tweet".' })
  }

  res.status(200).send({ message: 'Service added successfully' })
})

app.get('/services', (req, res) => {
  res.status(200).json({
    userServices: userServiceReplicas,
    tweetServices: tweetServiceReplicas
  })
})

// Start the service discovery server
app.listen(port, () => console.log(`Service Discovery running on port ${port}`))
