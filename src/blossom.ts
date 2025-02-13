import NDK, { NDKUser } from "@nostr-dev-kit/ndk";
import { areServersEqual, getServersFromServerListEvent, USER_BLOSSOM_SERVER_LIST_KIND } from "blossom-client-sdk";
import { publishBlossomServerList } from "./nostr.js";
import debug from "debug";
import { BLOSSOM_SERVERS } from "./env.js";

const log = debug("blossom");

export async function findBlossomServers(
  ndk: NDK,
  user: NDKUser,
  useUserServerList: boolean,
  publishUserServerList: boolean,
  additionalServers?: string[],
): Promise<string[]> {
  const blossomServerEvent = await ndk.fetchEvent([{ kinds: [USER_BLOSSOM_SERVER_LIST_KIND], authors: [user.pubkey] }]);

  const publicBlossomServers = blossomServerEvent
    ? getServersFromServerListEvent(blossomServerEvent).map((u) => stripTrailingSlash(u.toString()))
    : [];

  const blossomServers: string[] = useUserServerList
    ? mergeServers([...publicBlossomServers, ...BLOSSOM_SERVERS, ...(additionalServers || [])])
    : mergeServers([...BLOSSOM_SERVERS, ...(additionalServers || [])]);

  if (blossomServers.length == 0) throw new Error("No blossom servers found");

  if (publishUserServerList) {
    // If new servers were added, publish the new blossom server list

    if (
      blossomServers.length !== publicBlossomServers.length ||
      !blossomServers.every((bs) => publicBlossomServers.includes(bs))
    ) {
      console.log("Publishing blossom server list (Kind 10063)...");
      await publishBlossomServerList(ndk, user.pubkey, blossomServers);
    }
  }

  console.log("Using blossom servers: " + blossomServers.join(", "));
  return blossomServers;
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "");
}

function mergeServers(bunchOfServers: string[]) {
  const blossomServers: string[] = [];

  // merge with servers from config/environment/cmd line
  for (const bs of bunchOfServers) {
    const url = stripTrailingSlash(bs);
    if (!blossomServers.find((i) => areServersEqual(i, url))) {
      blossomServers.push(url);
    }
  }
  return blossomServers;
}
