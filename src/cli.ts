#!/usr/bin/env node
import { WebSocket } from "ws";
global.WebSocket = global.WebSocket || WebSocket;

import { Command } from "commander";
import ndk from "./ndk.js";
import { listRemoteFiles as findRemoteFiles, publishBlossomServerList } from "./nostr.js";
import { compareFiles as compareFileLists, getAllFiles as findAllLocalFiles } from "./files.js";
import { processUploads } from "./upload.js";
import { NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { BLOSSOM_SERVERS, NOSTR_PRIVATE_KEY } from "./env.js";
import { nip19 } from "nostr-tools";
import { areServersEqual, getServersFromServerListEvent, USER_BLOSSOM_SERVER_LIST_KIND } from "blossom-client-sdk";

let user: NDKUser;

if (NOSTR_PRIVATE_KEY) {
  const signer = new NDKPrivateKeySigner(NOSTR_PRIVATE_KEY);
  signer.blockUntilReady();
  user = await signer.user();
  console.log(`Using npub: ${user.npub}`);
  ndk.signer = signer;
}

const program = new Command();

// Command: upload files
program
  .command("upload")
  .description("Upload files from a directory")
  .argument("<file-or-folder>", "The file or folder that should be published.")
  .option("-f, --force", "Force publishing even if no changes were detected.", false)
  .option("-s, --servers <serverlist>", "A comma separated list of blossom servers to use.")
  .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
  //.option("-relays", "A comma separated list of relays servers to use.")
  .action(
    async (
      fileOrFolder: string,
      {
        force: optForce,
        servers: optServers,
        relays: optRelays,
        verbose: optVerbose,
      }: { force: boolean; servers: string; relays: string; verbose: boolean },
    ) => {
      try {
        const blossomServerEvent = await ndk.fetchEvent([
          { kinds: [USER_BLOSSOM_SERVER_LIST_KIND], authors: [user.pubkey] },
        ]);
        const publicBlossomServers = blossomServerEvent
          ? getServersFromServerListEvent(blossomServerEvent).map((u) => u.toString())
          : [];

        const blossomServers = [...publicBlossomServers];

        // merge with servers from config/environment
        for (const bs of [...BLOSSOM_SERVERS, ...(optServers ? optServers.split(",").map((s) => s.trim()) : [])]) {
          if (!blossomServers.find((i) => areServersEqual(i, bs))) {
            blossomServers.push(bs);
          }
        }

        if (publicBlossomServers.length < blossomServers.length) {
          console.log("Publishing blossom server list...");
          await publishBlossomServerList(ndk, user.pubkey, blossomServers);
        }

        if (blossomServers.length == 0) throw new Error("No blossom servers found");

        console.log("Using blossom servers: " + blossomServers.join(", "));

        const localFiles = await findAllLocalFiles(fileOrFolder);
        console.log(`${localFiles.length} files found locally in ${fileOrFolder}`);
        if (optVerbose) {
          console.log(localFiles.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));
        }

        const onlineFiles = await findRemoteFiles(ndk, user.pubkey);
        console.log(`${onlineFiles.length} files available online.`);
        if (optVerbose) {
          console.log(onlineFiles.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));
        }

        const { toUpload, existing, toDelete } = await compareFileLists(localFiles, onlineFiles);
        console.log(
          `${toUpload.length} new files to upload, ${existing.length} files unchanged, ${toDelete.length} files to delete online.`,
        );

        if (optForce) {
          // If force option is selected, add all existing files to be uploaded again
          toUpload.push(...existing);
        }

        if (toUpload.length > 0) {
          await processUploads(toUpload, blossomServers);
        }

        if (optVerbose) {
          console.log(toUpload.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));
        }

        // TODO add option to purge unused files (delete from blossom, send kind5 delete)

        process.exit(0);
      } catch (error) {
        console.error("Failed to fetch online files:", error);
      }
    },
  );

// Command: list all files available online
program
  .command("ls")
  .argument("[npub]", "The public key (npub) of web content to list.")
  .description("List all files available online")
  .action(async (npub?: string) => {
    const optionalPubKey = npub && (nip19.decode(npub).data as string);
    console.log("Listing web content for " + (npub || user.npub));
    const onlineFiles = await findRemoteFiles(ndk, optionalPubKey || user.pubkey);
    console.log(onlineFiles.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));

    process.exit(0);
  });

program
  .command("generate")
  .description("Generate a new private key")
  .action(async (cmdObj) => {
    const signer = NDKPrivateKeySigner.generate();
    console.log(signer.privateKey);
    const user = await signer.user();
    console.log(user.npub);

    //ndk.pool.connectedRelays().forEach(r => r.disconnect());
    process.exit(0);
  });

program.parse(process.argv);
