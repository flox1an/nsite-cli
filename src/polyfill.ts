import { ClientOptions, WebSocket } from "ws";
import { ClientRequestArgs } from "http";
import agent from "./proxy.js";
import fetch from "node-fetch";

class ProxyWebSocket extends WebSocket {
  constructor(address: string | URL, options?: ClientOptions | ClientRequestArgs) {
    super(address, { agent, ...options });
  }
}
// @ts-expect-error
global.WebSocket = agent ? ProxyWebSocket : WebSocket;

const proxiedFetch = (url: string, options: any = {}) => {
  return fetch(url, {
    ...options,
    agent,
  });
};

// Override global fetch with Proxy-fetch
(global as any).fetch = agent ? proxiedFetch : fetch;
