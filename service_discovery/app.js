import express from 'express'
import bodyParser from 'body-parser'

const app = express()
const port = 8040

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
    userServiceReplicas.push(newService)
  } else if (serviceType === 'tweet') {
    tweetServiceReplicas.push(newService)
  } else {
    console.log(`Failed attempt to add service { host: ${serviceHost}, port: ${servicePort}, type: ${serviceType} }`)
    return res.status(400).send({ message: 'Invalid serviceType. Expected "user" or "tweet".' })
  }

  console.log(`Service added successfully { host: ${serviceHost}, port: ${servicePort}, type: ${serviceType} }`)
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
