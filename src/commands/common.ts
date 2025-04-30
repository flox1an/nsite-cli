import NDK, { NDKEvent, NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import debug from "debug";
import { NOSTR_RELAYS } from "../env.js";

const log = debug("nsite");
const logSign = debug("nsite:sign");

let ndk: NDK | undefined = undefined;

export async function signEventTemplate(template: {
  kind: number;
  content: string;
  tags: any[];
  created_at: number;
}): Promise<any> {
  logSign("signEventTemplate called", template);
  const e = new NDKEvent(ndk);
  e.kind = template.kind;
  e.content = template.content;
  e.tags = template.tags;
  e.created_at = template.created_at;
  await e.sign();
  return e.rawEvent();
}

export async function initNdk(privateKey: string, relays: string[] = []): Promise<NDKUser> {
  let uniqueRelays = [...new Set([...relays, ...NOSTR_RELAYS]).values()];
  if (uniqueRelays.length === 0) {
    log("No relays found. Using fallback relays.");
    uniqueRelays = ["wss://nos.lol", "wss://relay.primal.net", "wss://relay.nostr.band", "wss://relay.damus.io"];
  }

  log("Using relays:", uniqueRelays.join(", "));
  ndk = new NDK({
    explicitRelayUrls: uniqueRelays,
  });

  let user: NDKUser;
  if (privateKey.startsWith("npub1")) {
    const pubkey = nip19.decode(privateKey).data as string;
    user = new NDKUser({ pubkey });
  } else if (privateKey.startsWith("bunker://")) {
    throw new Error("NIP46 not implemented");
  } else {
    const signer = new NDKPrivateKeySigner(privateKey);
    signer.blockUntilReady();
    user = await signer.user();
    ndk.signer = signer;
  }
  await ndk.connect();

  return user;
}

export function logFiles(
  files: { sha256: string; changedAt?: number; remotePath: string }[],
  options: { verbose: boolean },
) {
  if (options.verbose) {
    console.log(
      files
        .map((f) => {
          const date = f.changedAt ? new Date(f.changedAt * 1000).toISOString().slice(0, 19).replace("T", " ") : "-";
          return `${f.sha256}\t${date}\t${f.remotePath}`;
        })
        .join("\n"),
    );
  }
}

export function getNDK() {
  return ndk;
}
