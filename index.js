const util = require('util')
const _ = require('lodash')
const debug = require('debug')('botium-connector-cognigy')
const fs = require('fs')
const request = require('request-promise-native')
const path = require('path')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const CoreCapabilities = require('botium-core/src/Capabilities')

const logo = fs.readFileSync(path.join(__dirname, 'logo.png')).toString('base64')

const Capabilities = {
  COGNIGY_URL: 'COGNIGY_URL',
  COGNIGY_USER_ID: 'COGNIGY_USER_ID',
  COGNIGY_NLP_ANALYTICS_ENABLE: 'COGNIGY_NLP_ANALYTICS_ENABLE',
  COGNIGY_NLP_ANALYTICS_ODATA_URL: 'COGNIGY_NLP_ANALYTICS_ODATA_URL',
  COGNIGY_NLP_ANALYTICS_ODATA_APIKEY: 'COGNIGY_NLP_ANALYTICS_ODATA_APIKEY',
  COGNIGY_NLP_ANALYTICS_WAIT: 'COGNIGY_NLP_ANALYTICS_WAIT'
}

const Defaults = {
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

    if (!this.delegateContainer) {
      this.delegateCaps = {
        [CoreCapabilities.SIMPLEREST_URL]: this.caps[Capabilities.COGNIGY_URL],
        [CoreCapabilities.SIMPLEREST_METHOD]: 'POST',
        [CoreCapabilities.SIMPLEREST_BODY_TEMPLATE]: {
          userId: this.caps[Capabilities.COGNIGY_USER_ID] || '{{botium.conversationId}}',
          sessionId: '{{botium.conversationId}}',
          text: '{{msg.messageText}}'
        },
        [CoreCapabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$.outputStack.*',
        [CoreCapabilities.SIMPLEREST_RESPONSE_HOOK]: async ({ messageTextIndex, botMsg }) => {
          const sessionId = botMsg.sourceData.sessionId

          const sleep = async ms => {
            return new Promise((resolve) => {
              setTimeout(resolve, ms)
            })
          }

          if (this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ENABLE]) {
            try {
              const requestOptions = {
                method: 'GET',
                url: `${this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_URL]}/Records/`,
                qs: {
                  $select: 'intent,intentScore,timestamp',
                  $top: 100000,
                  $orderby: 'timestamp desc',
                  $filter: `sessionId eq '${sessionId}' or sessionId eq '${Date.now()}'`,
                  apikey: this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY]
                }
              }
              await sleep(this.caps[Capabilities.COGNIGY_NLP_ANALYTICS_WAIT] || 5000)
              const data = JSON.parse(await request(requestOptions))
              botMsg.nlp = {
                intent: this._extractIntent(data)
              }
            } catch (err) {
              debug(`Cannot process nlp data: ${err}`)
            }
          }

          const outputStack = `outputStack[${messageTextIndex}]`

          const botMsgs = []
          let qrsText = _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._quickReplies.text`)
          if (_.isNil(qrsText)) {
            qrsText = _.get(botMsg.sourceData, `${outputStack}.data._plugin.type`)
            if (qrsText) qrsText = `[${qrsText}]`
          }
          if (qrsText) {
            botMsgs.push(qrsText)
          } else {
            botMsgs.push(_.get(botMsg.sourceData, `${outputStack}.text`))
          }

          botMsg.messageText = [...new Set(botMsgs)].join(' ')

          // As i see the channel is bound to the endpoint. So we dont need an extra cap to choose it.
          // And we can read the response dynamical (more specific first?).
          // Or multi channel responses are possible?
          const qrs = _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._quickReplies.quickReplies`)
          if (qrs) {
            botMsg.buttons = qrs.map(qr => ({
              text: qr.title,
              payload: qr.payload,
              imageUri: qr.image_url
            }))
          }

          const buttons =
            _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._buttons.buttons`)
          if (buttons) {
            botMsg.buttons = buttons.map(qr => ({
              text: qr.title,
              payload: qr.payload || qr.url || qr.intentName
            }))
          }

          const media =
            _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._image`) ||
            _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._audio`) ||
            _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._video`)
          if (media) {
            botMsg.media = [{
              mediaUri: media.imageUrl || media.audioUrl || media.videoUrl,
              altText: ''
            }]
          }

          const ges = _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._gallery.items`) ||
            _.get(botMsg.sourceData, `${outputStack}.data._data._cognigy._default._list.items`)
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

  _extractIntent (queryResult) {
    if (queryResult.value && queryResult.value.length > 0 && queryResult.value[0].intent !== '') {
      return {
        name: queryResult.value[0].intent,
        confidence: queryResult.value[0].intentScore
      }
    }
    return {}
  }
}

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorCognigy,
  PluginDesc: {
    avatar: logo,
    provider: 'Cognigy AI',
    capabilities: [
      {
        name: 'COGNIGY_URL',
        label: 'COGNIGY_URL',
        description: 'Cognigy Rest Endpoint',
        type: 'url',
        required: true
      },
      {
        name: 'COGNIGY_USER_ID',
        label: 'COGNIGY_USER_ID',
        description: 'Cognigy User Id',
        type: 'string',
        required: false
      },
      {
        name: 'COGNIGY_NLP_ANALYTICS_ENABLE',
        label: 'Enable NLP Analytics',
        description: 'Disable if you don\'t need it (faster responses)',
        type: 'boolean',
        required: false
      },
      {
        name: 'COGNIGY_NLP_ANALYTICS_ODATA_URL',
        label: 'COGNIGY_NLP_ANALYTICS_ODATA_URL',
        description: 'OData Url where NLP Analyics Data is stored',
        type: 'url',
        required: false
      },
      {
        name: 'COGNIGY_NLP_ANALYTICS_ODATA_APIKEY',
        label: 'COGNIGY_NLP_ANALYTICS_ODATA_APIKEY',
        description: 'OData Api Key',
        type: 'string',
        required: false
      },
      {
        name: 'COGNIGY_NLP_ANALYTICS_WAIT',
        label: 'COGNIGY_NLP_ANALYTICS_WAIT',
        description: 'Time (in ms) to wait for fetching NLP Analyics Data after each Convo Step (Default: 5000)',
        type: 'int',
        required: false
      }
    ],
    features: {
      intentResolution: true,
      intentConfidenceScore: true
    }
  }
}
