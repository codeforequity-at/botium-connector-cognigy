const util = require('util')
const _ = require('lodash')
const debug = require('debug')('botium-connector-cognigy')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const CoreCapabilities = require('botium-core/src/Capabilities')

const Capabilities = {
  COGNIGY_URL: 'COGNIGY_URL',
  COGNIGY_USER_ID: 'COGNIGY_USER_ID'
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

  Validate () {
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
        [CoreCapabilities.SIMPLEREST_RESPONSE_JSONPATH]: '$.text',
        [CoreCapabilities.SIMPLEREST_RESPONSE_HOOK]: ({ botMsg }) => {
          const qrs = _.get(botMsg.sourceData, 'data._cognigy._facebook.message.quick_replies')
          if (qrs) {
            botMsg.buttons = qrs.map(qr => ({
              text: qr.title,
              payload: qr.payload,
              imageUri: qr.image_url
            }))
          }

          const ges = _.get(botMsg.sourceData, 'data._cognigy._facebook.message.attachment.payload.elements')
          if (ges) {
            botMsg.cards = ges.map(ge => ({
              text: ge.title,
              subtext: ge.subtitle,
              image: ge.image_url && { mediaUri: ge.image_url },
              buttons: ge.buttons && ge.buttons.map(b => ({
                text: b.title,
                payload: b.payload
              }))
            }))
          }
        }
      }
      debug(`Validate delegateCaps ${util.inspect(this.delegateCaps)}`)
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

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorCognigy
}
