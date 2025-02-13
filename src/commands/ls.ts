import { Command } from "commander";
import debug from "debug";
import { nip19 } from "nostr-tools";
import { initNdk, logFiles, getNDK } from "./common.js";
import { readProjectFile } from "../config.js";
import { listRemoteFiles as findRemoteFiles } from "../nostr.js";

const log = debug("nsite");

export default function registerLsCommand(program: Command) {
  program
    .command("ls")
    .argument("[npub]", "The public key (npub) of web content to list.")
    .option("-r, --relays <relays>", "The NOSTR relays to use (comma separated).", undefined)
    .option("-k, --privatekey <nsec>", "The private key (nsec/hex) to use for signing.", undefined)
    .description("List all files available online")
    .action(async (npub: string | undefined, options: { relays?: string; privatekey?: string }) => {
      log("ls called", npub);
      const projectData = readProjectFile();
      const optionalPubKey = npub && (nip19.decode(npub).data as string);
      const privateKey = npub || options.privatekey || projectData?.privateKey;
      if (!privateKey) {
        console.error("No private key found. Please set up a new project or specify a private key with --privatekey.");
        process.exit(1);
      }
      const user = await initNdk(privateKey, [...(projectData?.relays || []), ...(options.relays?.split(",") || [])]);

      if (!getNDK()) return;

      log("Listing web content for " + (npub || user.npub));
      const onlineFiles = await findRemoteFiles(getNDK()!, optionalPubKey || user.pubkey);
      logFiles(onlineFiles, { verbose: true });

      process.exit(0);
    });
}
