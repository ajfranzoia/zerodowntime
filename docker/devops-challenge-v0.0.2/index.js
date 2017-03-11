'use strict'

const pkg = require('./package.json')
const app = require('express')()
const mongo = require('mongodb').MongoClient
const port = process.env.PORT || 3000

app.get('/ping', (req, res) => {
  mongo.connect('mongodb://db/test', (err, db) => {
    if (err) return res.status(500).send(err)

    res.send(`You reached ${pkg.description}@${pkg.version}`)
  })
})

app.listen(port, (err) => {
  if (err) return process.exit(1)

  console.log(`Listening on port ${port}`)
})
