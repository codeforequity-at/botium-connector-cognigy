const assert = require("chai").assert;
const EventEmitter = require("events");
const BotiumConnectorCognigy = require("../../src/connector");

describe("Context Management", function () {
  let connector;
  let queueBotSays;
  let eventEmitter;
  let botMessages;

  beforeEach(function () {
    botMessages = [];
    queueBotSays = (botMsg) => {
      botMessages.push(botMsg);
    };
    eventEmitter = new EventEmitter();
  });

  afterEach(async function () {
    if (connector) {
      await connector.Stop();
      connector = null;
    }
  });

  describe("Initial Context Loading", function () {
    it("should load initial context from capability (object or JSON string format)", async function () {
      // Test object format
      const caps1 = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123", language: "en" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps1,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      assert.deepEqual(connector.contextData, {
        userId: "123",
        language: "en",
      });

      await connector.Stop();

      // Test JSON string format
      const caps2 = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: '{"userId":"456","language":"de"}',
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps2,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      assert.deepEqual(connector.contextData, {
        userId: "456",
        language: "de",
      });
    });

    it("should initialize empty context when not provided", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      assert.deepEqual(connector.contextData, {});
    });
  });

  describe("Context Sending - REST Endpoint", function () {
    it("should send initial context in requests", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123", language: "en" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK;
      const msg = { messageText: "Hello" };
      const requestOptions = { body: { text: "Hello", data: {} } };

      await connector.Start();
      requestHook({ msg, requestOptions });

      assert.deepEqual(requestOptions.body.data, {
        userId: "123",
        language: "en",
      });
    });

    it("should merge SET_COGNIGY_CONTEXT with existing context", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123", language: "en" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK;
      const msg = {
        messageText: "Hello",
        SET_COGNIGY_CONTEXT: { sessionToken: "abc", language: "de" },
      };
      const requestOptions = { body: { text: "Hello", data: {} } };

      requestHook({ msg, requestOptions });

      // Should merge new fields and update existing ones
      assert.deepEqual(requestOptions.body.data, {
        userId: "123",
        language: "de",
        sessionToken: "abc",
      });
      assert.deepEqual(connector.contextData, {
        userId: "123",
        language: "de",
        sessionToken: "abc",
      });
    });

    it("should call custom COGNIGY_REQUEST_HOOK after context injection", async function () {
      let customHookCalled = false;
      const customHook = () => {
        customHookCalled = true;
      };
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123" },
        COGNIGY_REQUEST_HOOK: customHook,
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK;
      const msg = { messageText: "Hello" };
      const requestOptions = { body: { text: "Hello", data: {} } };

      requestHook({ msg, requestOptions });

      assert.isTrue(customHookCalled);
      assert.deepEqual(requestOptions.body.data, { userId: "123" });
    });
  });

  describe("Context Receiving - REST Endpoint", function () {
    it("should extract context from bot response and update internal context", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK;
      const botMsg = { sender: "bot", sourceData: {} };
      const botMsgRoot = {
        text: "Hello there",
        data: {
          userId: "123",
          sessionToken: "xyz",
          preference: "dark",
        },
      };

      await responseHook({ botMsg, botMsgRoot });

      assert.deepEqual(botMsg.contextData, {
        userId: "123",
        sessionToken: "xyz",
        preference: "dark",
      });
      assert.deepEqual(connector.contextData, {
        userId: "123",
        sessionToken: "xyz",
        preference: "dark",
      });
    });

    it("should filter out Cognigy internal fields", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK;
      const botMsg = { sender: "bot", sourceData: {} };
      const botMsgRoot = {
        text: "Hello",
        data: {
          userId: "123",
          _cognigy: { internal: "data" },
          _plugin: { type: "button" },
          linear: "should be filtered",
          loop: "should be filtered",
          type: "should be filtered",
          customField: "should be kept",
        },
      };

      await responseHook({ botMsg, botMsgRoot });

      assert.deepEqual(botMsg.contextData, {
        userId: "123",
        customField: "should be kept",
      });
      assert.isUndefined(botMsg.contextData._cognigy);
      assert.isUndefined(botMsg.contextData.linear);
    });

    it("should not update context when response has empty or only internal data", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123", language: "en" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK;

      // Test empty data
      const botMsg1 = { sender: "bot", sourceData: {} };
      const botMsgRoot1 = { text: "Hello", data: {} };
      await responseHook({ botMsg: botMsg1, botMsgRoot: botMsgRoot1 });

      assert.isUndefined(botMsg1.contextData);
      assert.deepEqual(connector.contextData, {
        userId: "123",
        language: "en",
      });

      // Test only internal fields
      const botMsg2 = { sender: "bot", sourceData: {} };
      const botMsgRoot2 = {
        text: "Hi",
        data: {
          _cognigy: { internal: "data" },
          linear: "filtered",
        },
      };
      await responseHook({ botMsg: botMsg2, botMsgRoot: botMsgRoot2 });

      assert.isUndefined(botMsg2.contextData);
      assert.deepEqual(connector.contextData, {
        userId: "123",
        language: "en",
      });
    });

    it("should accumulate context across multiple responses", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK;

      // First response
      const botMsg1 = { sender: "bot", sourceData: {} };
      const botMsgRoot1 = {
        text: "Hello",
        data: { sessionToken: "xyz" },
      };
      await responseHook({ botMsg: botMsg1, botMsgRoot: botMsgRoot1 });

      assert.deepEqual(connector.contextData, {
        userId: "123",
        sessionToken: "xyz",
      });

      // Second response
      const botMsg2 = { sender: "bot", sourceData: {} };
      const botMsgRoot2 = {
        text: "How can I help?",
        data: { preference: "dark", language: "en" },
      };
      await responseHook({ botMsg: botMsg2, botMsgRoot: botMsgRoot2 });

      assert.deepEqual(connector.contextData, {
        userId: "123",
        sessionToken: "xyz",
        preference: "dark",
        language: "en",
      });
    });
  });

  describe("Context Persistence", function () {
    it("should maintain context across multiple user messages", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      const requestHook = connector.delegateCaps.SIMPLEREST_REQUEST_HOOK;
      const responseHook = connector.delegateCaps.SIMPLEREST_RESPONSE_HOOK;

      // First message
      const msg1 = { messageText: "Hello" };
      const reqOptions1 = { body: { text: "Hello", data: {} } };
      requestHook({ msg: msg1, requestOptions: reqOptions1 });

      assert.deepEqual(reqOptions1.body.data, { userId: "123" });

      // Simulate bot response adding context
      const botMsg1 = { sender: "bot", sourceData: {} };
      const botMsgRoot1 = { text: "Hi", data: { sessionToken: "xyz" } };
      await responseHook({ botMsg: botMsg1, botMsgRoot: botMsgRoot1 });

      // Second message should include accumulated context
      const msg2 = { messageText: "Book flight" };
      const reqOptions2 = { body: { text: "Book flight", data: {} } };
      requestHook({ msg: msg2, requestOptions: reqOptions2 });

      assert.deepEqual(reqOptions2.body.data, {
        userId: "123",
        sessionToken: "xyz",
      });
    });
  });

  describe("Context Cleanup", function () {
    it("should clear context on Stop (both REST and SOCKETIO)", async function () {
      // Test REST
      const caps1 = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123", language: "en" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps1,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      assert.deepEqual(connector.contextData, {
        userId: "123",
        language: "en",
      });

      await connector.Stop();
      assert.deepEqual(connector.contextData, {});

      // Test SOCKETIO
      const caps2 = {
        COGNIGY_ENDPOINT_TYPE: "SOCKETIO",
        COGNIGY_URL: "https://example.com/socketendpoint",
        COGNIGY_CONTEXT: { userId: "456" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps: caps2,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      assert.deepEqual(connector.contextData, { userId: "456" });

      await connector.Stop();
      assert.deepEqual(connector.contextData, {});
    });

    it("should reinitialize context on new Start", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: { userId: "123" },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      // Add some context
      connector.contextData.sessionToken = "xyz";
      assert.deepEqual(connector.contextData, {
        userId: "123",
        sessionToken: "xyz",
      });

      await connector.Stop();
      assert.deepEqual(connector.contextData, {});

      // Start again - should reinitialize with original context
      await connector.Start();
      assert.deepEqual(connector.contextData, { userId: "123" });
      assert.isUndefined(connector.contextData.sessionToken);
    });
  });

  describe("Edge Cases", function () {
    it("should handle various data types in context (null, arrays, nested objects)", async function () {
      const caps = {
        COGNIGY_ENDPOINT_TYPE: "REST",
        COGNIGY_URL: "https://example.com/endpoint",
        COGNIGY_CONTEXT: {
          userId: "123",
          optionalField: null,
          tags: ["vip", "premium"],
          settings: {
            theme: "dark",
            notifications: { email: true, sms: false },
          },
        },
      };

      connector = new BotiumConnectorCognigy({
        queueBotSays,
        caps,
        eventEmitter,
      });
      await connector.Validate();
      await connector.Start();

      assert.deepEqual(connector.contextData.tags, ["vip", "premium"]);
      assert.isNull(connector.contextData.optionalField);
      assert.equal(connector.contextData.settings.theme, "dark");
      assert.deepEqual(connector.contextData.settings.notifications, {
        email: true,
        sms: false,
      });
    });
  });
});
