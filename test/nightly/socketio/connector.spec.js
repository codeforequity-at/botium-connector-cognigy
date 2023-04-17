require('dotenv').config()
const assert = require('chai').assert
const BotiumConnectorCognigy = require('../../../src/connector')
const { readCaps } = require('../helper')
const EventEmitter = require('events')

describe('connector', function () {
  beforeEach(async function () {
    this.caps = readCaps()
    this.botMsgPromise = new Promise(resolve => {
      this.botMsgPromiseResolve = resolve
    })
    const queueBotSays = (botMsg) => {
      this.botMsgPromiseResolve(botMsg)
    }
    const setAsync = (isAsync) => {
      this.caps.RETRY_CONVO_ASYNC = isAsync
    }
    const eventEmitter = new EventEmitter()
    this.connector = new BotiumConnectorCognigy({ queueBotSays, caps: this.caps, setAsync, eventEmitter })
    await this.connector.Validate()
    await this.connector.Start()
  })

  it('should successfully get an answer for say hello', async function () {
    await this.connector.UserSays({ messageText: 'Hello' })
    const botMsg = await this.botMsgPromise
    assert.isTrue(botMsg?.nlp?.intent?.name === 'st_greeting_hello', `Incorrect intent "${botMsg?.nlp?.intent?.name}"`)
  }).timeout(10000)

  afterEach(async function () {
    await this.connector.Stop()
  })
})