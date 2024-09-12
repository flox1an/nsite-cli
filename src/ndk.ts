import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { NOSTR_RELAYS } from "./env.js";
import { EventTemplate, SignedEvent } from "blossom-client-sdk";

const ndk = new NDK({
  explicitRelayUrls: NOSTR_RELAYS,
});

ndk.connect();

export const signEventTemplate = async function signEventTemplate(template: EventTemplate): Promise<SignedEvent> {
  console.log("signEventTemplate called");
  const e = new NDKEvent(ndk);
  e.kind = template.kind;
  e.content = template.content;
  e.tags = template.tags;
  e.created_at = template.created_at;
  await e.sign();
  return e.rawEvent() as SignedEvent;
};

export default ndk;
