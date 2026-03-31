import { assert } from 'chai'
import { EventEmitter } from 'events'
import BotiumConnectorCognigy from '../../src/connector.js'

describe('Context Management', function () {
  let connector
  let queueBotSays
  let eventEmitter
  let botMessages

  beforeEach(function () {
    botMessages = []
    queueBotSays = (botMsg) => {
      botMessages.push(botMsg)
    }
    eventEmitter = new EventEmitter()
  })

  afterEach(async function () {
    if (connector) {
      await connector.Stop()
      connector = null
    }
  })

  describe('Initial Context Loading', function () {
    it('should load initial context from capability (object or JSON string format)', async function () {
      // Test object format
      const caps1 = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123', language: 'en' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps1,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      assert.deepEqual(connector.contextData, {
        userId: '123',
        language: 'en'
      })

      await connector.Stop()

      // Test JSON string format
      const caps2 = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: '{"userId":"456","language":"de"}'
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps2,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      assert.deepEqual(connector.contextData, {
        userId: '456',
        language: 'de'
      })
    })

    it('should initialize empty context when not provided', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint'
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      assert.deepEqual(connector.contextData, {})
    })
  })

  describe('Context Sending - REST Endpoint', function () {
    it('should send initial context in requests', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123', language: 'en' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK
      const msg = { messageText: 'Hello' }
      const requestOptions = { body: { text: 'Hello', data: {} } }

      await connector.Start()
      requestHook({ msg, requestOptions })

      assert.deepEqual(requestOptions.body.data, {
        userId: '123',
        language: 'en'
      })
    })

    it('should merge SET_COGNIGY_CONTEXT with existing context', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123', language: 'en' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK
      const msg = {
        messageText: 'Hello',
        SET_COGNIGY_CONTEXT: { sessionToken: 'abc', language: 'de' }
      }
      const requestOptions = { body: { text: 'Hello', data: {} } }

      requestHook({ msg, requestOptions })

      // Should merge new fields and update existing ones
      assert.deepEqual(requestOptions.body.data, {
        userId: '123',
        language: 'de',
        sessionToken: 'abc'
      })
      assert.deepEqual(connector.contextData, {
        userId: '123',
        language: 'de',
        sessionToken: 'abc'
      })
    })

    it('should call custom COGNIGY_REQUEST_HOOK after context injection', async function () {
      let customHookCalled = false
      const customHook = () => {
        customHookCalled = true
      }
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123' },
        COGNIGY_REQUEST_HOOK: customHook
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK
      const msg = { messageText: 'Hello' }
      const requestOptions = { body: { text: 'Hello', data: {} } }

      await requestHook({ msg, requestOptions })

      assert.isTrue(customHookCalled)
      assert.deepEqual(requestOptions.body.data, { userId: '123' })
    })
  })

  describe('Context Receiving - REST Endpoint', function () {
    it('should extract context from bot response and update internal context', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK
      const botMsg = { sender: 'bot', sourceData: {} }
      const botMsgRoot = {
        text: 'Hello there',
        data: {
          userId: '123',
          sessionToken: 'xyz',
          preference: 'dark'
        }
      }

      await responseHook({ botMsg, botMsgRoot })

      assert.deepEqual(botMsg.contextData, {
        userId: '123',
        sessionToken: 'xyz',
        preference: 'dark'
      })
      assert.deepEqual(connector.contextData, {
        userId: '123',
        sessionToken: 'xyz',
        preference: 'dark'
      })
    })

    it('should filter out Cognigy internal fields', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint'
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK
      const botMsg = { sender: 'bot', sourceData: {} }
      const botMsgRoot = {
        text: 'Hello',
        data: {
          userId: '123',
          _cognigy: { internal: 'data' },
          _plugin: { type: 'button' },
          linear: 'should be filtered',
          loop: 'should be filtered',
          type: 'should be filtered',
          customField: 'should be kept'
        }
      }

      await responseHook({ botMsg, botMsgRoot })

      assert.deepEqual(botMsg.contextData, {
        userId: '123',
        customField: 'should be kept'
      })
      assert.isUndefined(botMsg.contextData._cognigy)
      assert.isUndefined(botMsg.contextData.linear)
    })

    it('should not update context when response has empty or only internal data', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123', language: 'en' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK

      // Test empty data
      const botMsg1 = { sender: 'bot', sourceData: {} }
      const botMsgRoot1 = { text: 'Hello', data: {} }
      await responseHook({ botMsg: botMsg1, botMsgRoot: botMsgRoot1 })

      assert.isUndefined(botMsg1.contextData)
      assert.deepEqual(connector.contextData, {
        userId: '123',
        language: 'en'
      })

      // Test only internal fields
      const botMsg2 = { sender: 'bot', sourceData: {} }
      const botMsgRoot2 = {
        text: 'Hi',
        data: {
          _cognigy: { internal: 'data' },
          linear: 'filtered'
        }
      }
      await responseHook({ botMsg: botMsg2, botMsgRoot: botMsgRoot2 })

      assert.isUndefined(botMsg2.contextData)
      assert.deepEqual(connector.contextData, {
        userId: '123',
        language: 'en'
      })
    })

    it('should accumulate context across multiple responses', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK

      // First response
      const botMsg1 = { sender: 'bot', sourceData: {} }
      const botMsgRoot1 = {
        text: 'Hello',
        data: { sessionToken: 'xyz' }
      }
      await responseHook({ botMsg: botMsg1, botMsgRoot: botMsgRoot1 })

      assert.deepEqual(connector.contextData, {
        userId: '123',
        sessionToken: 'xyz'
      })

      // Second response
      const botMsg2 = { sender: 'bot', sourceData: {} }
      const botMsgRoot2 = {
        text: 'How can I help?',
        data: { preference: 'dark', language: 'en' }
      }
      await responseHook({ botMsg: botMsg2, botMsgRoot: botMsgRoot2 })

      assert.deepEqual(connector.contextData, {
        userId: '123',
        sessionToken: 'xyz',
        preference: 'dark',
        language: 'en'
      })
    })
  })

  describe('Context Persistence', function () {
    it('should maintain context across multiple user messages', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK
      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK

      // First message
      const msg1 = { messageText: 'Hello' }
      const reqOptions1 = { body: { text: 'Hello', data: {} } }
      requestHook({ msg: msg1, requestOptions: reqOptions1 })

      assert.deepEqual(reqOptions1.body.data, { userId: '123' })

      // Simulate bot response adding context
      const botMsg1 = { sender: 'bot', sourceData: {} }
      const botMsgRoot1 = { text: 'Hi', data: { sessionToken: 'xyz' } }
      await responseHook({ botMsg: botMsg1, botMsgRoot: botMsgRoot1 })

      // Second message should include accumulated context
      const msg2 = { messageText: 'Book flight' }
      const reqOptions2 = { body: { text: 'Book flight', data: {} } }
      requestHook({ msg: msg2, requestOptions: reqOptions2 })

      assert.deepEqual(reqOptions2.body.data, {
        userId: '123',
        sessionToken: 'xyz'
      })
    })
  })

  describe('Context Cleanup', function () {
    it('should clear context on Stop (both REST and SOCKETIO)', async function () {
      // Test REST
      const caps1 = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123', language: 'en' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps1,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      assert.deepEqual(connector.contextData, {
        userId: '123',
        language: 'en'
      })

      await connector.Stop()
      assert.deepEqual(connector.contextData, {})

      // Test SOCKETIO
      const caps2 = {
        COGNIGY_ENDPOINT_TYPE: 'SOCKETIO',
        COGNIGY_URL: 'https://example.com/socketendpoint',
        COGNIGY_CONTEXT: { userId: '456' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps2,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      assert.deepEqual(connector.contextData, { userId: '456' })

      await connector.Stop()
      assert.deepEqual(connector.contextData, {})
    })

    it('should reinitialize context on new Start', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: { userId: '123' }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      // Add some context
      connector.contextData.sessionToken = 'xyz'
      assert.deepEqual(connector.contextData, {
        userId: '123',
        sessionToken: 'xyz'
      })

      await connector.Stop()
      assert.deepEqual(connector.contextData, {})

      // Start again - should reinitialize with original context
      await connector.Start()
      assert.deepEqual(connector.contextData, { userId: '123' })
      assert.isUndefined(connector.contextData.sessionToken)
    })
  })

  describe('Edge Cases', function () {
    it('should handle various data types in context (null, arrays, nested objects)', async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: 'REST',
        COGNIGY_URL: 'https://example.com/endpoint',
        COGNIGY_CONTEXT: {
          userId: '123',
          optionalField: null,
          tags: ['vip', 'premium'],
          settings: {
            theme: 'dark',
            notifications: { email: true, sms: false }
          }
        }
      }

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter
      })
      await connector.Validate()
      await connector.Start()

      assert.deepEqual(connector.contextData.tags, ['vip', 'premium'])
      assert.isNull(connector.contextData.optionalField)
      assert.equal(connector.contextData.settings.theme, 'dark')
      assert.deepEqual(connector.contextData.settings.notifications, {
        email: true,
        sms: false
      })
    })
  })
})

describe('Adaptive Card Extraction', function () {
  let connector
  let queueBotSays
  let eventEmitter
  const baseCaps = {
    COGNIGY_ENDPOINT_TYPE: 'REST',
    COGNIGY_URL: 'https://example.com/endpoint'
  }

  beforeEach(async function () {
    queueBotSays = () => {}
    eventEmitter = new EventEmitter()
    connector = new BotiumConnectorCognigy({ queueBotSays, caps: baseCaps, eventEmitter })
    await connector.Validate()
    await connector.Start()
  })

  afterEach(async function () {
    if (connector) {
      await connector.Stop()
      connector = null
    }
  })

  describe('_extractBotAdaptiveCard - payload path resolution', function () {
    it('should extract card from REST nested path (data._data._cognigy._default._adaptiveCard)', function () {
      const botMsg = { sender: 'bot' }
      const card = { body: [{ type: 'TextBlock', text: 'Hello from REST' }] }
      const botMsgRoot = {
        data: { _data: { _cognigy: { _default: { _adaptiveCard: { adaptiveCard: card } } } } }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.isArray(botMsg.cards)
      assert.equal(botMsg.cards.length, 1)
      assert.deepEqual(botMsg.cards[0].text, ['Hello from REST'])
    })

    it('should extract card from SOCKETIO path (data._cognigy._default._adaptiveCard)', function () {
      const botMsg = { sender: 'bot' }
      const card = { body: [{ type: 'TextBlock', text: 'Hello from Socket' }] }
      const botMsgRoot = {
        data: { _cognigy: { _default: { _adaptiveCard: { adaptiveCard: card } } } }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.isArray(botMsg.cards)
      assert.equal(botMsg.cards.length, 1)
      assert.deepEqual(botMsg.cards[0].text, ['Hello from Socket'])
    })

    it('should prefer REST nested path over SOCKETIO path when both are present', function () {
      const botMsg = { sender: 'bot' }
      const restCard = { body: [{ type: 'TextBlock', text: 'REST' }] }
      const socketCard = { body: [{ type: 'TextBlock', text: 'Socket' }] }
      const botMsgRoot = {
        data: {
          _data: { _cognigy: { _default: { _adaptiveCard: { adaptiveCard: restCard } } } },
          _cognigy: { _default: { _adaptiveCard: { adaptiveCard: socketCard } } }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.deepEqual(botMsg.cards[0].text, ['REST'])
    })

    it('should do nothing when no adaptive card is present in response', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = { data: { someField: 'value' } }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.isUndefined(botMsg.cards)
    })

    it('should do nothing when adaptive card has no body', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: { _cognigy: { _default: { _adaptiveCard: { adaptiveCard: { actions: [] } } } } }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.isUndefined(botMsg.cards)
    })
  })

  describe('_extractBotAdaptiveCard - TextBlock extraction', function () {
    it('should extract multiple TextBlocks into card.text array', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [
                    { type: 'TextBlock', text: 'Title' },
                    { type: 'TextBlock', text: 'Subtitle' }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.deepEqual(botMsg.cards[0].text, ['Title', 'Subtitle'])
    })

    it('should set messageText from first TextBlock when messageText is not already set', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [
                    { type: 'TextBlock', text: 'First' },
                    { type: 'TextBlock', text: 'Second' }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.equal(botMsg.messageText, 'First')
    })

    it('should NOT override messageText when it is already set', function () {
      const botMsg = { sender: 'bot', messageText: 'Already set' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [{ type: 'TextBlock', text: 'Card text' }]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.equal(botMsg.messageText, 'Already set')
    })
  })

  describe('_extractBotAdaptiveCard - Image extraction', function () {
    it('should extract first image into card.image', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [
                    { type: 'Image', url: 'https://example.com/img.png', altText: 'A picture' }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.deepEqual(botMsg.cards[0].image, {
        mediaUri: 'https://example.com/img.png',
        altText: 'A picture'
      })
      assert.isFalse(botMsg.cards[0].media)
    })

    it('should put additional images into card.media array', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [
                    { type: 'Image', url: 'https://example.com/img1.png', alt: 'First' },
                    { type: 'Image', url: 'https://example.com/img2.png', alt: 'Second' },
                    { type: 'Image', url: 'https://example.com/img3.png', alt: 'Third' }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.deepEqual(botMsg.cards[0].image, { mediaUri: 'https://example.com/img1.png', altText: 'First' })
      assert.deepEqual(botMsg.cards[0].media, [
        { mediaUri: 'https://example.com/img2.png', altText: 'Second' },
        { mediaUri: 'https://example.com/img3.png', altText: 'Third' }
      ])
    })
  })

  describe('_extractBotAdaptiveCard - Button/Action extraction', function () {
    it('should extract top-level card actions into card.buttons', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [],
                  actions: [
                    { type: 'Action.Submit', title: 'Submit', data: 'submit_payload' },
                    { type: 'Action.OpenUrl', title: 'Open', url: 'https://example.com' }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.deepEqual(botMsg.cards[0].buttons, [
        { text: 'Submit', payload: 'submit_payload' },
        { text: 'Open', payload: 'https://example.com' }
      ])
    })

    it('should extract Action.* blocks from card body into buttons', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [
                    { type: 'TextBlock', text: 'Choose:' },
                    { type: 'Action.Submit', title: 'Yes', data: 'yes' },
                    { type: 'Action.Submit', title: 'No', data: 'no' }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      const buttons = botMsg.cards[0].buttons
      assert.isTrue(buttons.some(b => b.text === 'Yes' && b.payload === 'yes'))
      assert.isTrue(buttons.some(b => b.text === 'No' && b.payload === 'no'))
    })
  })

  describe('_extractBotAdaptiveCard - Input/Form extraction', function () {
    it('should extract Input.* elements into card.forms', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [
                    { type: 'Input.Text', id: 'name', label: 'Your Name' },
                    {
                      type: 'Input.ChoiceSet',
                      id: 'color',
                      label: 'Favorite Color',
                      choices: [
                        { title: 'Red', value: 'red' },
                        { title: 'Blue', value: 'blue' }
                      ]
                    }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.deepEqual(botMsg.cards[0].forms, [
        { name: 'name', label: 'Your Name', type: 'Text', options: undefined },
        {
          name: 'color',
          label: 'Favorite Color',
          type: 'ChoiceSet',
          options: [
            { title: 'Red', value: 'red' },
            { title: 'Blue', value: 'blue' }
          ]
        }
      ])
    })

    it('should set forms to null when no inputs are present', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: { body: [{ type: 'TextBlock', text: 'Hi' }] }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.isNull(botMsg.cards[0].forms)
    })
  })

  describe('_extractBotAdaptiveCard - nested cards (Action.ShowCard)', function () {
    it('should recursively extract nested cards from Action.ShowCard', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [{ type: 'TextBlock', text: 'Parent' }],
                  actions: [
                    {
                      type: 'Action.ShowCard',
                      title: 'Show more',
                      card: {
                        body: [{ type: 'TextBlock', text: 'Child card text' }],
                        actions: [{ type: 'Action.Submit', title: 'Done', data: 'done' }]
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      const parentCard = botMsg.cards[0]
      assert.deepEqual(parentCard.text, ['Parent'])
      assert.isArray(parentCard.cards)
      assert.equal(parentCard.cards.length, 1)

      const childCard = parentCard.cards[0]
      assert.deepEqual(childCard.text, ['Child card text'])
      assert.deepEqual(childCard.buttons, [{ text: 'Done', payload: 'done' }])
    })

    it('should set cards to null when no Action.ShowCard actions exist', function () {
      const botMsg = { sender: 'bot' }
      const botMsgRoot = {
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: {
                  body: [{ type: 'TextBlock', text: 'Hi' }],
                  actions: [{ type: 'Action.Submit', title: 'Go', data: 'go' }]
                }
              }
            }
          }
        }
      }

      connector._extractBotAdaptiveCard(botMsg, botMsgRoot)

      assert.isNull(botMsg.cards[0].cards)
    })
  })

  describe('_extractBotAdaptiveCard - multiple cards accumulated', function () {
    it('should push multiple cards when called multiple times on the same botMsg', function () {
      const botMsg = { sender: 'bot' }
      const makeRoot = (text) => ({
        data: {
          _cognigy: {
            _default: {
              _adaptiveCard: {
                adaptiveCard: { body: [{ type: 'TextBlock', text }] }
              }
            }
          }
        }
      })

      connector._extractBotAdaptiveCard(botMsg, makeRoot('Card 1'))
      connector._extractBotAdaptiveCard(botMsg, makeRoot('Card 2'))

      assert.equal(botMsg.cards.length, 2)
      assert.deepEqual(botMsg.cards[0].text, ['Card 1'])
      assert.deepEqual(botMsg.cards[1].text, ['Card 2'])
    })
  })

  describe('_deepFilter', function () {
    it('should return empty array for null or undefined input', function () {
      assert.deepEqual(connector._deepFilter(null, () => true, () => true), [])
      assert.deepEqual(connector._deepFilter(undefined, () => true, () => true), [])
    })

    it('should filter matching items from a flat array', function () {
      const items = [
        { type: 'TextBlock', text: 'A' },
        { type: 'Image', url: 'http://img' },
        { type: 'TextBlock', text: 'B' }
      ]
      const result = connector._deepFilter(
        items,
        (t) => t.type,
        (t) => t.type === 'TextBlock'
      )
      assert.equal(result.length, 2)
      assert.deepEqual(result.map(r => r.text), ['A', 'B'])
    })

    it('should recursively find items in nested objects', function () {
      const items = [
        {
          type: 'Container',
          items: [
            { type: 'TextBlock', text: 'Nested A' },
            { type: 'TextBlock', text: 'Nested B' }
          ]
        }
      ]
      const result = connector._deepFilter(
        items,
        (t) => t.type,
        (t) => t.type === 'TextBlock'
      )
      assert.equal(result.length, 2)
      assert.deepEqual(result.map(r => r.text), ['Nested A', 'Nested B'])
    })

    it('should not recurse into Action.ShowCard items', function () {
      const items = [
        {
          type: 'Action.ShowCard',
          card: {
            body: [{ type: 'TextBlock', text: 'Inside ShowCard - should not be found' }]
          }
        },
        { type: 'TextBlock', text: 'Outside' }
      ]
      const result = connector._deepFilter(
        items,
        (t) => t.type,
        (t) => t.type === 'TextBlock'
      )
      assert.equal(result.length, 1)
      assert.equal(result[0].text, 'Outside')
    })

    it('should return empty array when no items match the filter', function () {
      const items = [
        { type: 'Image', url: 'http://img' },
        { type: 'Action.Submit', title: 'Go' }
      ]
      const result = connector._deepFilter(
        items,
        (t) => t.type,
        (t) => t.type === 'TextBlock'
      )
      assert.deepEqual(result, [])
    })
  })
})
