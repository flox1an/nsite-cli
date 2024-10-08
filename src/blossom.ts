import NDK, { NDKUser } from "@nostr-dev-kit/ndk";
import { areServersEqual, getServersFromServerListEvent, USER_BLOSSOM_SERVER_LIST_KIND } from "blossom-client-sdk";
import { publishBlossomServerList } from "./nostr.js";
import debug from "debug";
import { BLOSSOM_SERVERS } from "./env.js";

const log = debug("blossom");

export async function findBlossomServers(
  ndk: NDK,
  user: NDKUser,
  publish: boolean,
  additionalServers?: string[],
): Promise<string[]> {
  const blossomServerEvent = await ndk.fetchEvent([{ kinds: [USER_BLOSSOM_SERVER_LIST_KIND], authors: [user.pubkey] }]);
  const publicBlossomServers = blossomServerEvent
    ? getServersFromServerListEvent(blossomServerEvent).map((u) => u.toString())
    : [];

  const blossomServers = [...publicBlossomServers];

  // merge with servers from config/environment/cmd line
  for (const bs of [...BLOSSOM_SERVERS, ...(additionalServers || [])]) {
    if (!blossomServers.find((i) => areServersEqual(i, bs))) {
      blossomServers.push(bs);
    }
  }

  // If new servers were added, publish the new blossom server list
  if (publish && publicBlossomServers.length < blossomServers.length) {
    console.log("Publishing blossom server list (Kind 10063)...");
    await publishBlossomServerList(ndk, user.pubkey, blossomServers);
  }

  if (blossomServers.length == 0) throw new Error("No blossom servers found");

  console.log("Using blossom servers: " + blossomServers.join(", "));
  return blossomServers;
}
