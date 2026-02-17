const util = require('util')
const _ = require('lodash')
const debug = require('debug')('botium-connector-cognigy')
const { URL } = require('url')
const { v4: uuidv4 } = require('uuid')
const path = require('path')
const { pathToFileURL } = require('url')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const { executeHook } = require('botium-core/src/helpers/HookUtils')
const CoreCapabilities = require('botium-core/src/Capabilities')
const { SocketClient } = require('@cognigy/socket-client')

const Capabilities = {
  COGNIGY_ENDPOINT_TYPE: 'COGNIGY_ENDPOINT_TYPE',
  COGNIGY_URL: 'COGNIGY_URL',
  COGNIGY_USER_ID: 'COGNIGY_USER_ID',
  COGNIGY_CONTEXT: 'COGNIGY_CONTEXT',
  COGNIGY_NLP_ANALYTICS_ENABLE: 'COGNIGY_NLP_ANALYTICS_ENABLE',
  COGNIGY_NLP_ANALYTICS_ODATA_URL: 'COGNIGY_NLP_ANALYTICS_ODATA_URL',
  COGNIGY_NLP_ANALYTICS_ODATA_APIKEY: 'COGNIGY_NLP_ANALYTICS_ODATA_APIKEY',
  COGNIGY_NLP_ANALYTICS_WAIT: 'COGNIGY_NLP_ANALYTICS_WAIT',
  COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL: 'COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL',
  COGNIGY_API_URL: 'COGNIGY_API_URL',
  COGNIGY_API_APIKEY: 'COGNIGY_API_APIKEY',
  COGNIGY_BODY_FROM_JSON: 'COGNIGY_BODY_FROM_JSON',
  COGNIGY_REQUEST_HOOK: 'COGNIGY_REQUEST_HOOK',
  COGNIGY_INCLUDE_EMPTY: 'COGNIGY_INCLUDE_EMPTY',
  COGNIGY_MESSAGE_LIST_MERGE: 'COGNIGY_MESSAGE_LIST_MERGE'
}

const Defaults = {
  [Capabilities.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL]: 1000,
  [Capabilities.COGNIGY_ENDPOINT_TYPE]: 'REST'
}

const _sleep = async ms => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const _loadHookFunction = async (caps, hookSpec) => {
  if (_.isFunction(hookSpec)) {
    debug('Hook is already a function')
    return hookSpec
  }

  if (_.isString(hookSpec) && caps.SAFEDIR) {
    const hookPath = path.resolve(caps.SAFEDIR, hookSpec)

    if (!hookPath.startsWith(path.resolve(caps.SAFEDIR))) {
      throw new Error(`Hook path "${hookPath}" is outside SAFEDIR`)
    }

    debug(`Loading hook from: ${hookPath}`)

    try {
      const fileUrl = pathToFileURL(hookPath).href
      const module = await import(fileUrl)
      const hookFn = module.default || module

      if (_.isFunction(hookFn)) {
        debug(`Successfully loaded ES module hook from ${hookSpec}`)
        return hookFn
      } else {
        throw new Error(`Expected function from hook, got: ${typeof hookFn}`)
      }
    } catch (error) {
      debug(`Failed to load hook: ${error.message}`)
      throw error
    }
  }

  throw new Error(`Hook must be a function or file path string, got: ${typeof hookSpec}`)
}

class BotiumConnectorCognigy {
  constructor ({ queueBotSays, caps, eventEmitter }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.delegateContainer = null
    this.delegateCaps = null
    this.nlpSessionIdCache = {}
    this.wsClient = null
    this.eventEmitter = eventEmitter
  }

  async Validate () {
    debug('Validate called')

    this.caps = Object.assign({}, Defaults, this.caps)

    if (this.caps[Capabilities.COGNIGY_USER_ID] === '') this.caps[Capabilities.COGNIGY_USER_ID] = undefined
    if (!this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE]) throw new Error('COGNIGY_ENDPOINT_TYPE capability required')
    if (!this.caps[Capabilities.COGNIGY_URL]) throw new Error('COGNIGY_URL capability required')
    if (this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE] && !this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_URL]) throw new Error('COGNIGY_NLP_ANALYTICS_ODATA_URL capability required (if NLP analytics enabled)')
    if (this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE] && !this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY]) throw new Error('COGNIGY_NLP_ANALYTICS_ODATA_APIKEY capability required (if NLP analytics enabled)')

    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      if (!this.delegateContainer) {
        this.delegateCaps = {
          [CoreCapabilities.SIMPLEREST_URL]: this.caps[Capabilities.COGNIGY_URL],
          [CoreCapabilities.SIMPLEREST_METHOD]: 'POST',
          [CoreCapabilities.SIMPLEREST_BODY_TEMPLATE]: {
            userId: this.caps[Capabilities.COGNIGY_USER_ID] || '{{botium.conversationId}}',
            sessionId: '{{botium.conversationId}}',
            text: '{{msg.messageText}}',
            data: {}
          },
          [CoreCapabilities.SIMPLEREST_BODY_FROM_JSON]: this.caps[Capabilities.COGNIGY_BODY_FROM_JSON],
          [CoreCapabilities.SIMPLEREST_BODY_JSONPATH]: '$.outputStack.*',
          [CoreCapabilities.SIMPLEREST_REQUEST_HOOK]: async (args) => {
            const { msg, requestOptions } = args
            // Merge initial context with any SET_COGNIGY_CONTEXT from the message
            const contextToSend = Object.assign({}, this.contextData)

            if (msg.SET_COGNIGY_CONTEXT) {
              Object.assign(contextToSend, msg.SET_COGNIGY_CONTEXT)
              Object.assign(this.contextData, msg.SET_COGNIGY_CONTEXT)
              debug(`Updated context with SET_COGNIGY_CONTEXT: ${JSON.stringify(msg.SET_COGNIGY_CONTEXT)}`)
            }

            // Inject context into request body data field
            if (Object.keys(contextToSend).length > 0) {
              requestOptions.body.data = contextToSend
              debug(`Sending context in request: ${JSON.stringify(contextToSend)}`)
            }

            // Call user's custom request hook if provided
            // Load at Botium Box level (supports ES modules)
            if (this.caps[Capabilities.COGNIGY_REQUEST_HOOK]) {
              try {
                // Load hook at Botium Box level (handles ES modules)
                const hookFunction = await _loadHookFunction(this.caps, this.caps[Capabilities.COGNIGY_REQUEST_HOOK])

                // Execute the loaded function
                await executeHook(this.caps, hookFunction, args)
              } catch (err) {
                console.error('ERROR in custom COGNIGY_REQUEST_HOOK:', err.message)
                console.error('Stack:', err.stack)
              }
            } else {
              console.log('3. No COGNIGY_REQUEST_HOOK capability found')
              console.log('   - Available capabilities:', Object.keys(this.caps).filter(k => k.includes('COGNIGY')))
            }

            console.log('========== COGNIGY REQUEST HOOK END ==========')
          },
          [CoreCapabilities.SIMPLEREST_IGNORE_EMPTY]: !this.caps[Capabilities.COGNIGY_INCLUDE_EMPTY],
          [CoreCapabilities.SIMPLEREST_MESSAGE_LIST_MERGE]: this.caps[Capabilities.COGNIGY_MESSAGE_LIST_MERGE],
          [CoreCapabilities.SIMPLEREST_RESPONSE_HOOK]: async ({ botMsg, botMsgRoot }) => {
            await this._extractNlp(botMsg)

            // Extract context from response (filter out internal Cognigy fields)
            if (botMsgRoot.data) {
              // Filter out Cognigy internal fields (fields starting with _ and known internal properties)
              const contextData = Object.keys(botMsgRoot.data)
                .filter(key => !key.startsWith('_') && !['linear', 'loop', 'text', 'type', 'data'].includes(key))
                .reduce((obj, key) => {
                  obj[key] = botMsgRoot.data[key]
                  return obj
                }, {})

              if (Object.keys(contextData).length > 0) {
                botMsg.contextData = contextData
                Object.assign(this.contextData, contextData)
                debug(`Extracted context from response: ${JSON.stringify(contextData)}`)
              }
            }

            this._extractBotText(botMsg, botMsgRoot)
            this._extractBotButtons(botMsg, botMsgRoot)
            this._extractBotMedia(botMsg, botMsgRoot)
            this._extractBotQuickReplies(botMsg, botMsgRoot)
            this._extractBotGalleryItems(botMsg, botMsgRoot)
            this.prevTimestamp = new Date().toISOString()
          }
        }
        debug(`Validate delegateCaps ${util.inspect(this.delegateCaps)}`)
        this.delegateCaps = Object.assign({}, this.caps, this.delegateCaps)
        this.delegateContainer = new SimpleRestContainer({ queueBotSays: this.queueBotSays, caps: this.delegateCaps })
      }
      debug('Validate delegate')
      return this.delegateContainer.Validate()
    }
  }

  Build () {
    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      return this.delegateContainer.Build()
    }
  }

  async Start () {
    this.prevTimestamp = new Date().toISOString()
    this.contextData = {}

    // Load initial context from capabilities
    if (this.caps[Capabilities.COGNIGY_CONTEXT]) {
      if (_.isString(this.caps[Capabilities.COGNIGY_CONTEXT])) {
        Object.assign(this.contextData, JSON.parse(this.caps[Capabilities.COGNIGY_CONTEXT]))
      } else {
        Object.assign(this.contextData, this.caps[Capabilities.COGNIGY_CONTEXT])
      }
      debug(`Loaded initial context: ${JSON.stringify(this.contextData)}`)
    }

    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      return this.delegateContainer.Start()
    } else {
      this.sessionId = uuidv4()
      const cognigyUrl = new URL(this.caps[Capabilities.COGNIGY_URL])
      this.wsClient = new SocketClient(cognigyUrl.origin, cognigyUrl.pathname.replace('/', ''), {
        forceWebsockets: true,
        userId: this.caps[Capabilities.COGNIGY_USER_ID],
        sessionId: this.sessionId
      })

      this.wsClient.on('output', async (botMsgRoot) => {
        const botMsg = {
          sender: 'bot',
          sourceData: botMsgRoot
        }

        // Extract context from SOCKETIO response (filter out internal Cognigy fields)
        if (botMsgRoot.data) {
          // Filter out Cognigy internal fields (fields starting with _ and known internal properties)
          const contextData = Object.keys(botMsgRoot.data)
            .filter(key => !key.startsWith('_') && !['linear', 'loop', 'text', 'type', 'data'].includes(key))
            .reduce((obj, key) => {
              obj[key] = botMsgRoot.data[key]
              return obj
            }, {})

          if (Object.keys(contextData).length > 0) {
            botMsg.contextData = contextData
            Object.assign(this.contextData, contextData)
            debug(`Extracted context from SOCKETIO response: ${JSON.stringify(contextData)}`)
          }
        }

        await this._extractNlp(botMsg)
        this._extractBotText(botMsg, botMsgRoot)
        this._extractBotButtons(botMsg, botMsgRoot)
        this._extractBotMedia(botMsg, botMsgRoot)
        this._extractBotQuickReplies(botMsg, botMsgRoot)
        this._extractBotGalleryItems(botMsg, botMsgRoot)
        if (Object.keys(botMsg).length > 2) {
          this._sendBotMsg(botMsg)
        }
        this.prevTimestamp = new Date().toISOString()
      })

      this.wsClient.on('error', async (err) => {
        this._sendBotMsg(new Error(err.message))
      })

      try {
        this.wsClient.connect()
      } catch (err) {
        return Promise.reject(new Error(`Error connecting to Cognigy: ${err.message}`))
      }
      return Promise.resolve()
    }
  }

  UserSays (msg) {
    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      return this.delegateContainer.UserSays(msg)
    } else {
      const payload = {
        text: msg.messageText
      }

      // Add context if available
      const contextToSend = Object.assign({}, this.contextData)
      if (msg.SET_COGNIGY_CONTEXT) {
        Object.assign(contextToSend, msg.SET_COGNIGY_CONTEXT)
        Object.assign(this.contextData, msg.SET_COGNIGY_CONTEXT)
        debug(`Updated context with SET_COGNIGY_CONTEXT: ${JSON.stringify(msg.SET_COGNIGY_CONTEXT)}`)
      }

      if (Object.keys(contextToSend).length > 0) {
        payload.data = contextToSend
        debug(`Sending context via SOCKETIO: ${JSON.stringify(contextToSend)}`)
      }

      this.wsClient.sendMessage(payload.text, payload.data)
    }
  }

  Stop () {
    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      this.contextData = {}
      return this.delegateContainer.Stop()
    } else {
      this.contextData = {}
      this.sessionId = null
      if (this.wsClient) {
        this.wsClient.disconnect()
        this.wsClient = null
      }
    }
  }

  Clean () {
    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      return this.delegateContainer.Clean()
    }
  }

  _extractBotText (botMsg, botMsgRoot) {
    const botMsgs = []
    let qrsText = _.get(botMsgRoot, 'data._data._cognigy._default._quickReplies.text') ||
                  _.get(botMsgRoot, 'data._cognigy._default._quickReplies.text')
    if (_.isNil(qrsText)) {
      qrsText = _.get(botMsgRoot, 'data._data._cognigy._default._buttons.text') ||
                _.get(botMsgRoot, 'data._cognigy._default._buttons.text')
    }
    if (_.isNil(qrsText)) {
      qrsText = _.get(botMsgRoot, 'data._plugin.type')
      if (qrsText) qrsText = `[${qrsText}]`
    }
    if (qrsText) {
      botMsgs.push(qrsText)
    } else {
      botMsgs.push(_.get(botMsgRoot, 'text'))
    }

    if (botMsgs.length === 1 && !_.isNil(botMsgs[0])) {
      botMsg.messageText = [...new Set(botMsgs)].join(' ')
    }
  }

  _extractBotMedia (botMsg, botMsgRoot) {
    const media =
            _.get(botMsgRoot, 'data._data._cognigy._default._image') ||
            _.get(botMsgRoot, 'data._data._cognigy._default._audio') ||
            _.get(botMsgRoot, 'data._data._cognigy._default._video')
    if (media) {
      botMsg.media = [{
        mediaUri: media.imageUrl || media.audioUrl || media.videoUrl,
        altText: ''
      }]
    }
  }

  _extractBotButtons (botMsg, botMsgRoot) {
    const buttons =
            _.get(botMsgRoot, 'data._data._cognigy._default._buttons.buttons') ||
            _.get(botMsgRoot, 'data._cognigy._default._buttons.buttons')
    if (buttons) {
      const buttonsTransformed = buttons.filter(qr => qr.payload || qr.url || qr.intentName).map(qr => ({
        text: qr.title,
        payload: qr.payload || qr.url || qr.intentName
      }))
      if (!botMsg.buttons) {
        botMsg.buttons = []
      }
      buttonsTransformed.forEach(b => botMsg.buttons.push(b))
    }
  }

  _extractBotQuickReplies (botMsg, botMsgRoot) {
    const qrs = _.get(botMsgRoot, 'data._data._cognigy._default._quickReplies.quickReplies') ||
                _.get(botMsgRoot, 'data._cognigy._default._quickReplies.quickReplies')
    if (qrs) {
      if (!botMsg.buttons) {
        botMsg.buttons = []
      }
      const qrsTransformed = qrs.filter(qr => qr.payload).map(qr => ({
        text: qr.title,
        payload: qr.payload,
        imageUri: qr.image_url
      }))
      qrsTransformed.forEach(qr => botMsg.buttons.push(qr))
    }
  }

  _extractBotGalleryItems (botMsg, botMsgRoot) {
    const ges = _.get(botMsgRoot, 'data._data._cognigy._default._gallery.items') ||
    _.get(botMsgRoot, 'data._data._cognigy._default._list.items')
    if (ges) {
      botMsg.cards = ges.map(ge => ({
        text: ge.title,
        subtext: ge.subtitle,
        image: ge.imageUrl && { mediaUri: ge.imageUrl },
        buttons: ge.buttons && ge.buttons.map(b => ({
          text: b.title,
          payload: b.payload
        }))
      }))
    }
  }

  _sendBotMsg (botMsg) {
    setTimeout(() => this.queueBotSays(botMsg), 0)
  }

  async _extractNlp (botMsg) {
    // if there are more bot messages in one response, then it has no sense to extract NLP data, except the first one.
    // Subsequent extractions would retrieve nothing, so they would just do some unnecessary requests.
    if (botMsg?.sourceData?.nlpRequestOptions) {
      debug('NLP ODATA Request skipped, nlp info already extracted for this response')
      return
    }
    debug('NLP ODATA Request start')
    const sessionId = botMsg.sourceData.sessionId || this.sessionId
    if (!sessionId) {
      debug(`NLP ODATA Request skipped, session id is not found. Source data: ${JSON.stringify(botMsg.sourceData)}`)
    } else if (!this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE]) {
      debug('NLP ODATA Request skipped, it is disabled')
    } else {
      const odataURL = this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_URL]
      let version = odataURL.indexOf('/v') > 0 && parseFloat(odataURL.substring(odataURL.indexOf('/v') + 2))
      const urlHasVersion = !!version
      // if version is not set in the url, then use the latest
      const LATEST = 2.3
      version = urlHasVersion ? version : LATEST
      const base = urlHasVersion ? odataURL.substring(0, odataURL.indexOf('/v')) : odataURL
      const url = `${base}/v${version}/${version === 2.3 ? 'Analytics' : version < 2 ? 'Records' : 'Inputs'}/`
      const maxIterations = Math.ceil((this.caps.COGNIGY_NLP_ANALYTICS_WAIT || 5000) / (this.caps.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL || Defaults.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL))
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        await _sleep(this.caps.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL || Defaults.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL)

        let nlpQueryResult = null
        try {
          const queryParams = {
            $select: 'intent,intentScore,timestamp',
            $top: 100000,
            $orderby: 'timestamp%20desc',
            $filter: `sessionId%20eq%20'${sessionId}'%20and%20timestamp%20gt%20'${this.prevTimestamp}'`,
            apikey: this.caps.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY
          }
          const nlpRequestOptions = { queryParams, url }
          botMsg.sourceData.nlpRequestOptions = nlpRequestOptions
          debug(`NLP ODATA Request ${iteration + 1}/${maxIterations}: ${JSON.stringify(nlpRequestOptions, null, 2)}`)

          const dataRaw = await fetch(new URL('?' + new URLSearchParams(queryParams).toString(), url).toString())
          if (dataRaw.ok) {
            nlpQueryResult = await dataRaw.json()
            debug(`NLP ODATA Response ${iteration + 1}/${maxIterations}: ${(JSON.stringify(nlpQueryResult))}`)

            botMsg.sourceData.nlpResponse = nlpQueryResult
          } else {
            debug(`NLP ODATA failed with ${dataRaw.status}`)
          }
        } catch (err) {
          debug(`NLP ODATA Response ${iteration + 1}/${maxIterations} ignored, JSON parse err: ${err.message}`)
          continue
        }
        if (nlpQueryResult && nlpQueryResult.value && nlpQueryResult.value.length > 0) {
          if (nlpQueryResult.value[0].intent && nlpQueryResult.value[0].intent.length > 0) {
            botMsg.nlp = {
              intent: {
                name: nlpQueryResult.value[0].intent,
                confidence: nlpQueryResult.value[0].intentScore
              }
            }
          }
          break
        }
      }
    }
  }
}

module.exports = BotiumConnectorCognigy
