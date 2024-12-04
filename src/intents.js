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
  while (true) {
    const r = await fn(Object.assign({}, opts, { skip: result.length, limit: CONTENT_PAGE_SIZE }))
    if (r.items && r.items.length > 0) {
      result.push(...r.items)
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
  if (!endpoint) throw new Error(`Endpoint for URL ${container.pluginInstance.caps.COGNIGY_URL} not found. Available rest endpoint tokens are: ${endpoints.filter(e => e.channel === 'rest').map(e => e.URLToken).join(', ')} `)
  const endpointDetails = await client.readEndpoint({ endpointId: endpoint._id })
  if (!endpointDetails) throw new Error(`Endpoint details for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)

  const allLocales = await _retrieveAll(client.indexLocales.bind(client))
  const locale = allLocales.find(l => l.referenceId === endpointDetails.localeId)
  if (!locale) throw new Error(`Locale for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)

  const allFlows = await _retrieveAll(client.indexFlows.bind(client))
  const endpointFlow = allFlows.find(f => f.referenceId === endpointDetails.flowId)
  if (!endpointFlow) throw new Error(`Endpoint flow for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)
  const endpointFlowDetails = await client.readFlow({ flowId: endpointFlow._id })
  if (!endpointFlowDetails) throw new Error(`Endpoint flow details for URL ${container.pluginInstance.caps.COGNIGY_URL} not found`)
  for (const endpoint of endpoints) {
    const endpointDetails = await client.readEndpoint({ endpointId: endpoint._id })
    const endpointFlow = allFlows.find(f => f.referenceId === endpointDetails.flowId)
    const locale = allLocales.find(l => l.referenceId === endpointDetails.localeId)
    status(`Identified endpoint "${endpointDetails.URLToken}" (${endpointDetails.name}) assigned to flow "${endpointFlow ? endpointFlow._id : 'N/A'}" (${endpointFlow ? endpointFlow.name : 'N/A'}) and locale "${locale ? locale._id : 'N/A'}" (${locale ? locale.name : 'N/A'}) using channel "${endpointDetails.channel}"`)
  }
  status(`Identified entry endpoint "${endpointDetails.URLToken}" (${endpointDetails.name}) assigned to flow "${endpointFlow ? endpointFlow._id : 'N/A'}" (${endpointFlow ? endpointFlow.name : 'N/A'}) and locale "${locale ? locale._id : 'N/A'}" (${locale ? locale.name : 'N/A'}) using channel "${endpointDetails.channel}"`)

  const mainFlowLocale = allLocales.find(l => l._id === endpointFlowDetails.localeReference)
  status(`Identified main flow "${endpointFlowDetails.name}" (${endpointFlow._id}) using locale "${mainFlowLocale ? mainFlowLocale._id : 'N/A'}" (${mainFlowLocale ? mainFlowLocale.name : 'N/A'}) for Cognigy Rest Endpoint "${endpointDetails.name}" (${container.pluginInstance.caps.COGNIGY_URL})`)

  const flows = [endpointFlow]
  for (const flowId of endpointFlowDetails.attachedFlows) {
    flows.push(await client.readFlow({ flowId }))
  }
  status(`Identified attached flows "${(endpointFlowDetails.attachedFlows && endpointFlowDetails.attachedFlows.length > 0) ? endpointFlowDetails.attachedFlows.join(',') : 'N/A'}" for Cognigy Rest Endpoint "${endpointDetails.name}"`)

  const allIntents = []

  for (const projectFlow of flows) {
    const flowDetails = await client.readFlow({ flowId: projectFlow._id })
    const exportedIntents = await client.exportIntents({ flowId: flowDetails._id, localeId: mainFlowLocale._id, format: 'json' })
    if (exportedIntents && exportedIntents.length > 0) {
      status(`Downloaded ${exportedIntents.length} intent(s) (${exportedIntents.map(i => i.name).join(', ')}) for flow "${flowDetails.name}" (${flowDetails._id}) using locale "${flowDetails.localeReference}"`)
      const disabledIntents = exportedIntents.filter(i => i.isDisabled)
      if (disabledIntents.length > 0) {
        status(`Identified disabled intents "${disabledIntents.map(i => i.name).join(', ')}" in flow "${flowDetails.name}" (${flowDetails._id}) using locale "${flowDetails.localeReference}"`)
      }
      allIntents.push(...exportedIntents.filter(i => !i.isDisabled))
    }
  }
  status(`Downloaded ${allIntents.length} intent(s) for Cognigy Rest Endpoint "${endpointDetails.name}"`)

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
