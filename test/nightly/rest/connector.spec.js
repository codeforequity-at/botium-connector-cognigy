require('dotenv').config()
const assert = require('chai').assert
const BotiumConnectorCognigy = require('../../../src/connector')
const { readCaps } = require('../helper')
const EventEmitter = require('events')

describe('connector', function () {
  beforeEach(async function () {
    this.init = async (caps) => {    
      caps = Object.assign({}, readCaps(), caps)
      this.botMsgPromise = new Promise(resolve => {
        this.botMsgPromiseResolve = resolve
      })
      const queueBotSays = (botMsg) => {
        this.botMsgPromiseResolve(botMsg)
      }
      const eventEmitter = new EventEmitter()
      this.connector = new BotiumConnectorCognigy({ queueBotSays, caps, eventEmitter })
      await this.connector.Validate()
      await this.connector.Start()
    }
  })

  it('should successfully get an answer for say hello', async function () {
    await this.init()
    await this.connector.UserSays({ messageText: 'Hello' })
    const botMsg = await this.botMsgPromise
    assert.deepEqual(botMsg?.messageText, 'Hello! Welcome to Cognigy Support. How can I assist you today?')
  }).timeout(1000000)

  it('should handle request hook', async function () {
    await this.init({ "COGNIGY_REQUEST_HOOK": ({ requestOptions, context, botium }) => {
      requestOptions.body.sessionId = "dummySessionId";
    } })
    await this.connector.UserSays({ messageText: 'Hello' })
    const botMsg = await this.botMsgPromise
    assert.isTrue(botMsg?.sourceData?.sessionId === 'dummySessionId', `Incorrect sessionId "${botMsg?.sourceData?.sessionId}"`)
  }).timeout(1000000)

  afterEach(async function () {
    await this.connector.Stop()
  })
})
