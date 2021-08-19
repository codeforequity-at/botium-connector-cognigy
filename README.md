0# Botium Connector for Cognigy AI

[![NPM](https://nodei.co/npm/botium-connector-cognigy.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-cognigy/)

[![Codeship Status for codeforequity-at/botium-connector-cognigy](https://app.codeship.com/projects/7ebeef20-e9d6-0137-bd39-4a621f4be870/status?branch=master)](https://app.codeship.com/projects/374237)
[![npm version](https://badge.fury.io/js/botium-connector-cognigy.svg)](https://badge.fury.io/js/botium-connector-cognigy)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()


This is a [Botium](https://github.com/codeforequity-at/botium-core) connector for testing your [Cognigy AI](https://cognigy.com/) chatbot.

__Did you read the [Botium in a Nutshell](https://medium.com/@floriantreml/botium-in-a-nutshell-part-1-overview-f8d0ceaf8fb4) articles? Be warned, without prior knowledge of Botium you won't be able to properly use this library!__

## How it works
Botium connects to the [REST Endpoint](https://docs.cognigy.com/v3.0/docs/deploy-a-rest-endpoint) of your Cognigy AI chatbot.

It can be used as any other Botium connector with all Botium Stack components:
* [Botium CLI](https://github.com/codeforequity-at/botium-cli/)
* [Botium Bindings](https://github.com/codeforequity-at/botium-bindings/)
* [Botium Box](https://www.botium.at)

## Requirements
* **Node.js and NPM**
* a **Cognigy AI bot**
* a **project directory** on your workstation to hold test cases and Botium configuration

## Install Botium and Cognigy AI Connector

When using __Botium CLI__:

```
> npm install -g botium-cli
> npm install -g botium-connector-cognigy
> botium-cli init
> botium-cli run
```

When using __Botium Bindings__:

```
> npm install -g botium-bindings
> npm install -g botium-connector-cognigy
> botium-bindings init mocha
> npm install && npm run mocha
```

When using __Botium Box__:

_Already integrated into Botium Box, no setup required_

## Connecting Cognigy AI chatbot to Botium

1. In your Cognigy project, deploy a [REST Endpoint](https://docs.cognigy.com/v3.0/docs/deploy-a-rest-endpoint)
2. Create a botium.json in your project directory and add your Cognigy Endpoint URL

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "cognigy",
      "COGNIGY_URL": "https://endpoint-demo.cognigy.ai/xxxxxxxxxxxxxxxxxxxxxx",
    }
  }
}
```
3. (Optional) If you want to enable NLP Analytics (Intent Resolution, Confidence Score), follow these steps:

    3.1. Enable [Collect Analytics](https://docs.cognigy.com/docs/data-management#collect-analytics) in your Entpoint Settings

    3.2. Find your [Cognigy OData Endpoint](https://docs.cognigy.com/docs/odata-analytics-endpoint)

    3.3. Create an [Api Key](https://docs.cognigy.com/docs/my-profile#api-keys) in your Cognigy Profile

    3.4. Adjust the botium.json file:
```
    {
      "botium": {
        "Capabilities": {
          "PROJECTNAME": "<whatever>",
          "CONTAINERMODE": "cognigy",
          "COGNIGY_URL": "https://endpoint-demo.cognigy.ai/xxxxxxxxxxxxxxxxxxxxxx",
          "COGNIGY_NLP_ANALYTICS_ENABLE": true,
          "COGNIGY_NLP_ANALYTICS_ODATA_URL": "https://odata-demo.cognigy.ai",
          "COGNIGY_NLP_ANALYTICS_ODATA_APIKEY": "xxxxxxxxxxxxxxxxxxxxxxxxxx"
        }
      }
    }
```

4. To check the configuration, run the emulator (Botium CLI required) to bring up a chat interface in your terminal window:

```
> botium-cli emulator
```

Botium setup is ready, you can begin to write your [BotiumScript](https://github.com/codeforequity-at/botium-core/wiki/Botium-Scripting) files.

## How to start samples

* Adapt botium.json in the sample directory
* Install packages, run the test

```
> cd ./samples/travelbook
> npm install && npm test
```

## Supported Capabilities

Set the capability __CONTAINERMODE__ to __cognigy__ to activate this connector.

### COGNIGY_URL
Cognigy REST Endpoint URL

### COGNIGY_USER_ID
User id

Optional. Will be a generated GUID by default.

### COGNIGY_NLP_ANALYTICS_ENABLE
Enable NLP Analyics (Intent Resolution, Confidence Score)

Disable if you don't need this feature (faster responses)

### COGNIGY_NLP_ANALYTICS_ODATA_URL
Cognigy OData Analyics Endpoint

Optional. Only needed if NLP Analyics is enabled.

More about Cognigy Odata Endpoint you can find in [Cognigy Docs - OData Analyics Endpoint](https://docs.cognigy.com/docs/odata-analytics-endpoint)

### COGNIGY_NLP_ANALYTICS_ODATA_APIKEY
OData Api Key

Optional. Only needed if NLP Analyics is enabled.

More about Cognigy Api Keys you can find in [Cognigy Docs - Api Keys](https://docs.cognigy.com/docs/my-profile#api-keys)

### COGNIGY_NLP_ANALYTICS_WAIT
Time to wait for fetching NLP Analyics Data after each Convo Step (in milliseconds)

Default: 5000

### Roadmap
* Support for additional channel and channel content
* Support for intent/entity asserter
* Support for sentiment analyze
