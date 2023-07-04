require('dotenv').config()
const assert = require('chai').assert
const EventEmitter = require('events')
const _ = require('lodash')

const BotiumConnectorCognigy = require('../../../src/connector')
const { readCaps } = require('../helper')

describe('connector', function () {
  beforeEach(async function () {
    this.caps = readCaps()
    this.botMsgPromise = new Promise((resolve, reject) => {
      this.botMsgPromiseResolve = resolve
      this.botMsgPromiseReject = reject
    })
    const queueBotSays = (botMsg) => {
      if (!_.isError(botMsg)) {
        this.botMsgPromiseResolve(botMsg)
      } else {
        this.botMsgPromiseReject(botMsg)
      }
    }
    const eventEmitter = new EventEmitter()
    this.connector = new BotiumConnectorCognigy({ queueBotSays, caps: this.caps, eventEmitter })
    await this.connector.Validate()
    await this.connector.Start()
  })

  it('should successfully get an answer for say hello', async function () {
    await this.connector.UserSays({ messageText: 'Hello' })
    const botMsg = await this.botMsgPromise
    assert.isTrue(botMsg?.nlp?.intent?.name === 'st_greeting_hello', `Incorrect intent "${botMsg?.nlp?.intent?.name}" in ${JSON.stringify(botMsg)}"`)
  }).timeout(1000000)

  afterEach(async function () {
    await this.connector.Stop()
  })
})
