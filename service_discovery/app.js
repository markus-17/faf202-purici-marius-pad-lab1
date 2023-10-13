import express from 'express'
import bodyParser from 'body-parser'

const app = express()
const port = 8040

// const userServiceReplicas = []
// const tweetServiceReplicas = []

app.use(bodyParser.json())

app.get('/status', (req, res) => {
  res.status(200).json({ status: 'OK' })
})

app.post('/services', (req, res) => {
  res.status(200)
})

app.get('/services', (req, res) => {
  res.status(200)
})

// Start the service discovery server
app.listen(port, () => console.log(`Gateway running on port ${port}`))
