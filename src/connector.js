const util = require('util')
const _ = require('lodash')
const debug = require('debug')('botium-connector-cognigy')
const request = require('request-promise-native')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const CoreCapabilities = require('botium-core/src/Capabilities')

const Capabilities = {
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
  [Capabilities.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL]: 5000
}

const _sleep = async ms => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

class BotiumConnectorCognigy {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.delegateContainer = null
    this.delegateCaps = null
  }

  async Validate () {
    debug('Validate called')

    Object.assign(this.caps, Defaults)

    if (!this.caps[Capabilities.COGNIGY_URL]) throw new Error('COGNIGY_URL capability required')
    if (this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE] && !this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_URL]) throw new Error('COGNIGY_NLP_ANALYTICS_ODATA_URL capability required (if NLP analytics enabled)')
    if (this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE] && !this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY]) throw new Error('COGNIGY_NLP_ANALYTICS_ODATA_APIKEY capability required (if NLP analytics enabled)')

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
          const sessionId = botMsg.sourceData.sessionId

          if (sessionId && this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE]) {
            const isV20 = `${this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_URL]}`.indexOf('v2.0') > 0

            const until = Date.now() + (this.caps.COGNIGY_NLP_ANALYTICS_WAIT || 5000)
            while (true) {
              if (until < Date.now()) break
              await _sleep(this.caps.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL || Defaults.COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL)

              let nlpQueryResult = null
              try {
                const nlpRequestOptions = {
                  method: 'GET',
                  url: isV20 ? `${this.caps.COGNIGY_NLP_ANALYTICS_ODATA_URL}/Inputs/` : `${this.caps.COGNIGY_NLP_ANALYTICS_ODATA_URL}/Records/`,
                  qs: {
                    $select: 'intent,intentScore,timestamp',
                    $top: 100000,
                    $orderby: 'timestamp desc',
                    $filter: `sessionId eq '${sessionId}' or sessionId eq '${Date.now()}'`,
                    apikey: this.caps.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY
                  }
                }
                botMsg.sourceData.nlpRequestOptions = nlpRequestOptions
                debug('NLP ODATA Request: ' + JSON.stringify(nlpRequestOptions, null, 2))

                const dataRaw = await request(nlpRequestOptions)
                debug('NLP ODATA Response: ' + JSON.stringify(dataRaw, null, 2))
                nlpQueryResult = JSON.parse(dataRaw)
                botMsg.sourceData.nlpResponse = nlpQueryResult
              } catch (err) {
                debug(`NLP ODATA Response err: ${err.message}`)
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

          botMsg.messageText = [...new Set(botMsgs)].join(' ')

          // As i see the channel is bound to the endpoint. So we dont need an extra cap to choose it.
          // And we can read the response dynamical (more specific first?).
          // Or multi channel responses are possible?
          const qrs = _.get(botMsgRoot, 'data._data._cognigy._default._quickReplies.quickReplies')
          if (qrs) {
            botMsg.buttons = qrs.map(qr => ({
              text: qr.title,
              payload: qr.payload,
              imageUri: qr.image_url
            }))
          }

          const buttons =
            _.get(botMsgRoot, 'data._data._cognigy._default._buttons.buttons')
          if (buttons) {
            botMsg.buttons = buttons.map(qr => ({
              text: qr.title,
              payload: qr.payload || qr.url || qr.intentName
            }))
          }

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
      }
      debug(`Validate delegateCaps ${util.inspect(this.delegateCaps)}`)
      this.delegateCaps = Object.assign({}, this.caps, this.delegateCaps)
      this.delegateContainer = new SimpleRestContainer({ queueBotSays: this.queueBotSays, caps: this.delegateCaps })
    }

    debug('Validate delegate')
    return this.delegateContainer.Validate()
  }

  Build () {
    return this.delegateContainer.Build()
  }

  Start () {
    return this.delegateContainer.Start()
  }

  UserSays (msg) {
    return this.delegateContainer.UserSays(msg)
  }

  Stop () {
    return this.delegateContainer.Stop()
  }

  Clean () {
    return this.delegateContainer.Clean()
  }
}

module.exports = BotiumConnectorCognigy
