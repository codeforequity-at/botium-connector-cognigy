const util = require('util')
const _ = require('lodash')
const debug = require('debug')('botium-connector-cognigy')
const request = require('request-promise-native')
const { URL } = require('url')
const { v4: uuidv4 } = require('uuid')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const CoreCapabilities = require('botium-core/src/Capabilities')
const { SocketClient } = require('@cognigy/socket-client')

const Capabilities = {
  COGNIGY_ENDPOINT_TYPE: 'COGNIGY_ENDPOINT_TYPE',
  COGNIGY_URL: 'COGNIGY_URL',
  COGNIGY_USER_ID: 'COGNIGY_USER_ID',
  COGNIGY_NLP_ANALYTICS_ENABLE: 'COGNIGY_NLP_ANALYTICS_ENABLE',
  COGNIGY_NLP_ANALYTICS_ODATA_URL: 'COGNIGY_NLP_ANALYTICS_ODATA_URL',
  COGNIGY_NLP_ANALYTICS_ODATA_APIKEY: 'COGNIGY_NLP_ANALYTICS_ODATA_APIKEY',
  COGNIGY_NLP_ANALYTICS_WAIT: 'COGNIGY_NLP_ANALYTICS_WAIT',
  COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL: 'COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL',
  COGNIGY_API_URL: 'COGNIGY_API_URL',
  COGNIGY_API_APIKEY: 'COGNIGY_API_APIKEY'
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
            text: '{{msg.messageText}}'
          },
          [CoreCapabilities.SIMPLEREST_BODY_JSONPATH]: '$.outputStack.*',
          [CoreCapabilities.SIMPLEREST_RESPONSE_HOOK]: async ({ botMsg, botMsgRoot }) => {
            await this._extractNlp(botMsg)

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
      this.wsClient.sendMessage(msg.messageText)
    }
  }

  Stop () {
    if (this.caps[Capabilities.COGNIGY_ENDPOINT_TYPE] !== 'SOCKETIO') {
      return this.delegateContainer.Stop()
    } else {
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
    let qrsText = _.get(botMsgRoot, 'data._data._cognigy._default._quickReplies.text')
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
            _.get(botMsgRoot, 'data._data._cognigy._default._buttons.buttons')
    if (buttons) {
      const buttonsTransformed = buttons.filter(qr => qr.payload || qr.url || qr.intentName).map(qr => ({
        text: qr.title,
        payload: qr.payload || qr.url || qr.intentName
      }))
      buttonsTransformed.forEach(b => botMsg.buttons.push(b))
    }
  }

  _extractBotQuickReplies (botMsg, botMsgRoot) {
    const qrs = _.get(botMsgRoot, 'data._data._cognigy._default._quickReplies.quickReplies')
    if (qrs) {
      botMsg.buttons = qrs.filter(qr => qr.payload).map(qr => ({
        text: qr.title,
        payload: qr.payload,
        imageUri: qr.image_url
      }))
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
    const sessionId = botMsg.sourceData.sessionId || this.sessionId
    if (sessionId && this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE]) {
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
          const nlpRequestOptions = {
            method: 'GET',
            url: url,
            qs: {
              $select: 'intent,intentScore,timestamp',
              $top: 100000,
              $orderby: 'timestamp desc',
              $filter: `sessionId eq '${sessionId}' and timestamp gt '${this.prevTimestamp}'`,
              apikey: this.caps.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY
            }
          }
          botMsg.sourceData.nlpRequestOptions = nlpRequestOptions
          debug(`NLP ODATA Request ${iteration + 1}/${maxIterations}: ${JSON.stringify(nlpRequestOptions, null, 2)}`)

          const dataRaw = await request(nlpRequestOptions)
          debug(`NLP ODATA Response ${iteration + 1}/${maxIterations}: ${dataRaw}`)
          nlpQueryResult = JSON.parse(dataRaw)
          botMsg.sourceData.nlpResponse = nlpQueryResult
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
