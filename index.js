const fs = require('fs')
const path = require('path')
const BotiumConnectorCognigyClass = require('./src/connector')
const { importHandler, importArgs } = require('./src/intents')

const logo = fs.readFileSync(path.join(__dirname, 'logo.png')).toString('base64')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorCognigyClass,
  Import: {
    Handler: importHandler,
    Args: importArgs
  },
  PluginDesc: {
    avatar: logo,
    provider: 'Cognigy AI',
    capabilities: [
      {
        name: 'COGNIGY_ENDPOINT_TYPE',
        label: 'Endpoint Type',
        type: 'choice',
        choices: [
          { name: 'REST', key: 'REST' },
          { name: 'SocketIO', key: 'SOCKETIO' }
        ],
        required: true
      },
      {
        name: 'COGNIGY_URL',
        label: 'Endpoint Url',
        description: 'Endpoint URL, something like "https://endpoint-xxx.cognigy.ai/xxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
        type: 'url',
        required: true
      },
      {
        name: 'COGNIGY_USER_ID',
        label: 'User Id',
        description: 'If empty, a random user id will be generated',
        type: 'string',
        required: false,
        advanced: true
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
        label: 'OData Url',
        description: 'OData Url where NLP Analyics Data is stored, something like "https://odata-xxx.cognigy.ai/v2.0"',
        type: 'url',
        required: false
      },
      {
        name: 'COGNIGY_NLP_ANALYTICS_ODATA_APIKEY',
        label: 'OData Api Key',
        description: 'OData Api Key for NLP Analytics',
        type: 'secret',
        required: false
      },
      {
        name: 'COGNIGY_NLP_ANALYTICS_WAIT_INTERVAL',
        label: 'OData NLP Timeout',
        description: 'Time (in ms) to wait for availability of NLP Analyics Data after each Convo Step (Default: 5000ms)',
        type: 'int',
        required: false,
        advanced: true
      },
      {
        name: 'COGNIGY_API_URL',
        label: 'API Endpoint Url',
        description: 'API Endpoint URL, something like "https://api-xxx.cognigy.ai"',
        type: 'url',
        required: false,
        advanced: true
      },
      {
        name: 'COGNIGY_API_APIKEY',
        label: 'API Key',
        description: 'API Key for downloading using the API Endpoint',
        type: 'secret',
        required: false,
        advanced: true
      }
    ],
    features: {
      intentResolution: true,
      intentConfidenceScore: true,
      testCaseGeneration: true,
      testCaseExport: false
    }
  }
}
