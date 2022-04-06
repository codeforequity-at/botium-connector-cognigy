const _ = require('lodash')
const { RestAPIClient } = require('@cognigy/rest-api-client')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-cognigy-intents')

const getCaps = (caps) => {
  const result = caps || {}
  return result
}

const CONTENT_PAGE_SIZE = 100

const _retrieveAll = async (fn, opts = {}) => {
  const result = []
  let skip = 0
  while (true) {
    const r = await fn(Object.assign({}, opts, { skip, limit: CONTENT_PAGE_SIZE }))
    if (r.items && r.items.length > 0) {
      result.push(...r.items)
      skip += result.length
    } else {
      break
    }
  }
  return result
}

const _buildClient = (caps) => {
  const apiKey = caps.COGNIGY_API_APIKEY || caps.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY
  let baseUrl = caps.COGNIGY_API_URL
  if (!baseUrl) {
    if (caps.COGNIGY_URL.indexOf('cognigy.ai') >= 0) {
      if (caps.COGNIGY_URL.indexOf('-trial') >= 0) {
        baseUrl = 'https://api-trial.cognigy.ai'
      } else {
        baseUrl = 'https://api-app.cognigy.ai'
      }
    }
  }
  if (!baseUrl) throw new Error('COGNIGY_API_URL not given')

  const client = new RestAPIClient({
    baseUrl
  })
  client.setCredentials({
    type: 'ApiKey',
    apiKey: apiKey
  })
  return client
}

const importCognigyIntents = async ({ caps, buildconvos }, { statusCallback }) => {
  const status = (log, obj) => {
    if (obj) debug(log, obj)
    else debug(log)
    if (statusCallback) statusCallback(log, obj)
  }

  const driver = new BotDriver(getCaps(caps))
  const container = await driver.Build()

  if (!container.pluginInstance.caps.COGNIGY_URL && !container.pluginInstance.caps.COGNIGY_API_URL) throw new Error('COGNIGY_URL or COGNIGY_API_URL capability required')
  if (!container.pluginInstance.caps.COGNIGY_NLP_ANALYTICS_ODATA_APIKEY && !container.pluginInstance.caps.COGNIGY_API_APIKEY) throw new Error('COGNIGY_NLP_ANALYTICS_ODATA_APIKEY or COGNIGY_API_APIKEY capability required')

  const client = _buildClient(container.pluginInstance.caps)

  const endpoints = await _retrieveAll(client.indexEndpoints.bind(client))

  const endpoint = endpoints.find(e => e.channel === 'rest' && container.pluginInstance.caps.COGNIGY_URL.indexOf(e.URLToken) >= 0)
  if (!endpoint) throw new Error(`Endpoint for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)
  const endpointDetails = await client.readEndpoint({ endpointId: endpoint._id })
  if (!endpointDetails) throw new Error(`Endpoint details for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)

  const allFlows = await _retrieveAll(client.indexFlows.bind(client))
  const endpointFlow = allFlows.find(f => f.referenceId === endpointDetails.flowId)
  if (!endpointFlow) throw new Error(`Endpoint flow for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)
  const endpointFlowDetails = await client.readFlow({ flowId: endpointFlow._id })
  if (!endpointFlowDetails) throw new Error(`Endpoint flow details for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)

  status(`Identified main flow "${endpointFlowDetails.name}" for Cognigy Rest Endpoint "${endpointDetails.name}"`)

  const projectFlows = await _retrieveAll(client.indexFlows.bind(client), { projectId: endpointFlowDetails.projectReference })

  const allIntents = []

  for (const projectFlow of projectFlows) {
    const flowDetails = await client.readFlow({ flowId: projectFlow._id })
    const exportedIntents = await client.exportIntents({ flowId: flowDetails._id, localeId: flowDetails.localeReference, format: 'json' })
    status(`Downloaded ${exportedIntents.length} intent(s) for flow "${flowDetails.name}": ${exportedIntents.map(i => i.name).join(',')}`)
    allIntents.push(...exportedIntents)
  }

  const convos = []
  const utterances = []

  // dealing with openai alternatives like
  // [[vraag|Vraag]] [[yanmelding|Aanmelden]]
  // or
  // [go[edemorgen|Hallo]]
  const resolveAlternatives = (str) => {
    const nextBlock = (str, start = 0) => {
      const index1 = str.indexOf('[', start)
      if (index1 < 0) {
        return
      }
      const index2 = str.indexOf('[', index1 + 1)
      if (index2 < 0) {
        return
      }
      const index3 = str.indexOf('|', index2 + 1)
      if (index3 < 0) {
        return
      }
      const index4 = str.indexOf(']', index3 + 1)
      if (index4 < 0) {
        return
      }
      const index5 = str.indexOf(']', index4 + 1)
      if (index5 < 0) {
        return
      }

      const alternative1 = str.substring(index1, index3).split('[').join('')
      const alternative2 = str.substring(index3 + 1, index5).split(']').join('')

      return { start: index1, end: index5, alternatives: _.uniq([alternative1, alternative2]) }
    }

    const blocks = []

    let block = nextBlock(str)
    while (block) {
      blocks.push(block)
      block = nextBlock(str, block.end)
    }

    blocks.reverse()

    let result = [str]
    for (const block of blocks) {
      const subresult = []
      for (const alternative of block.alternatives) {
        for (const entry of result) {
          subresult.push(entry.substring(0, block.start) + alternative + entry.substring(block.end + 1))
        }
      }
      result = subresult
    }

    return result
  }

  for (const intent of allIntents) {
    const utteranceList = intent.exampleSentences.filter(p => p).reduce((prev, current) => {
      prev = prev.concat(resolveAlternatives(current))
      return prev
    }, [])
    utterances.push({ name: intent.name, utterances: _.uniq(utteranceList) })
  }

  if (buildconvos) {
    for (const utterance of utterances) {
      const convo = {
        header: {
          name: utterance.name
        },
        conversation: [
          {
            sender: 'me',
            messageText: utterance.name
          },
          {
            sender: 'bot',
            asserters: [
              {
                name: 'INTENT',
                args: [utterance.name]
              }
            ]
          }
        ]
      }
      convos.push(convo)
    }
  }
  return { convos, utterances }
}

module.exports = {
  importHandler: ({ caps, buildconvos, ...rest } = {}, { statusCallback } = {}) => importCognigyIntents({ caps, buildconvos, ...rest }, { statusCallback }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    buildconvos: {
      describe: 'Build convo files for intent assertions (otherwise, just write utterances files)',
      type: 'boolean',
      default: false
    }
  }
}

const caps = {
  "botium": {
    "Capabilities": {
      "CONTAINERMODE": "cognigy",
      "COGNIGY_URL": "https://endpoint-eon.cognigy.cloud/29e07336e0a7dac6e91129c0779d73a76fb752a5941fa632a44bb32de5c8132d",
      "COGNIGY_NLP_ANALYTICS_ENABLE": true,
      "COGNIGY_NLP_ANALYTICS_ODATA_APIKEY": "dd10e5ef8223d274ebeae3eac39d2722695e6034a4798b42d8a77b94c7b8dc2c050676dcf9e0e7bd07de2c6f3b82ef0ac35a495c05f173b37fe25d790fb5c330",
      "COGNIGY_NLP_ANALYTICS_ODATA_URL": "https://odata-eon.cognigy.cloud/",
      "COGNIGY_API_URL": "https://api-eon.cognigy.cloud",
      "COGNIGY_API_APIKEY": "dd10e5ef8223d274ebeae3eac39d2722695e6034a4798b42d8a77b94c7b8dc2c050676dcf9e0e7bd07de2c6f3b82ef0ac35a495c05f173b37fe25d790fb5c330   "
    },
    "Sources": {},
    "Envs": {}
  }
}
importCognigyIntents({caps: caps.botium.Capabilities}, {}).then(res => // TODO
  console.log(`res ===> ${JSON.stringify(res)}`)
)
