#!/usr/bin/env node
import { WebSocket } from "ws";
global.WebSocket = global.WebSocket || WebSocket;

import { Command } from "commander";
import { broadcastRelayList, listRemoteFiles as findRemoteFiles } from "./nostr.js";
import { compareFiles as compareFileLists, getLocalFiles as findAllLocalFiles } from "./files.js";
import { processUploads } from "./upload.js";
import NDK, { NDKEvent, NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { NOSTR_PRIVATE_KEY, NOSTR_RELAYS } from "./env.js";
import { nip19 } from "nostr-tools";
import { BlossomClient, EventTemplate, SignedEvent } from "blossom-client-sdk";
import path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readProjectFile } from "./config.js";
import debug from "debug";
import { findBlossomServers } from "./blossom.js";
import { setupProject } from "./setup-project.js";
import { FileList } from "./types.js";

const log = debug("nsite");
const logSign = debug("nsite:sign");
const error = debug("nsite:error");

let ndk: NDK | undefined = undefined;

export const signEventTemplate = async function signEventTemplate(template: EventTemplate): Promise<SignedEvent> {
  logSign("signEventTemplate called", template);
  const e = new NDKEvent(ndk);
  e.kind = template.kind;
  e.content = template.content;
  e.tags = template.tags;
  e.created_at = template.created_at;
  await e.sign();
  return e.rawEvent() as SignedEvent;
};

async function initNdk(privateKey: string, relays: string[] = []): Promise<NDKUser> {
  let uniqueRelays = [...new Set([...relays, ...NOSTR_RELAYS]).values()];
  if (uniqueRelays.length == 0) {
    log("No relays found. Using fallback relays.");
    uniqueRelays = ["wss://nos.lol", "wss://relay.primal.net", "wss://relay.nostr.band", "wss://relay.damus.io"];
  }

  log("Using relays:", uniqueRelays.join(", "));
  ndk = new NDK({
    explicitRelayUrls: uniqueRelays,
  });

  let user: NDKUser;
  if (privateKey.startsWith("npub1")) {
    // log in with npub
    const pubkey = nip19.decode(privateKey).data as string;
    user = new NDKUser({ pubkey });
  } else if (privateKey.startsWith("bunker://")) {
    // TODO implement NIP46
    // https://github.com/nostr-dev-kit/ndk/blob/master/ndk/src/signers/nip46/index.ts#L21
    throw new Error("NIP46 not implemented");
  } else {
    // log in with nsec or hex key
    const signer = new NDKPrivateKeySigner(privateKey);
    signer.blockUntilReady();
    user = await signer.user();
    // console.log(`Using npub: ${user.npub}`);
    ndk.signer = signer;
  }
  await ndk.connect();

  return user;
}

function logFiles(files: FileList, options: { verbose: boolean }) {
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

const program = new Command("nsite-cli");

// TODO add rate limiting for certain relays

// Command: upload files
program
  .command("upload")
  .description("Upload files from a directory")
  .argument("<folder>", "The folder that should be published.") // TODO add support for single files
  .option("-f, --force", "Force publishing even if no changes were detected.", false)
  .option("-s, --servers <servers>", "The blossom servers to use (comma separated).", undefined)
  .option("-r, --relays <relays>", "The NOSTR relays to use (comma separated).", undefined)
  .option("-k, --privatekey <nsec>", "The private key (nsec/hex) to use for signing.", undefined)
  .option("-p, --purge", "Delete online file events that are not used anymore.", false)
  .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
  .action(
    async (
      fileOrFolder: string,
      options: {
        force: boolean;
        verbose: boolean;
        purge: boolean;
        servers?: string;
        relays?: string;
        privatekey?: string;
      },
    ) => {
      log("upload called", options);
      const projectData = readProjectFile();

      const privateKey = options.privatekey || NOSTR_PRIVATE_KEY || projectData?.privateKey;
      if (!privateKey) {
        console.error("No private key found. Please set up a new project or specify a private key with --privatekey.");
        process.exit(1);
      }
      const user = await initNdk(privateKey, [...(projectData?.relays || []), ...(options.relays?.split(",") || [])]);

      if (!ndk) return;

      const pool = ndk.outboxPool || ndk.pool;
      const relayUrls = [...pool.relays.values()].map((r) => r.url);
      console.log("Using relays:", relayUrls.join(", "));
      await broadcastRelayList(ndk, relayUrls, relayUrls);

      try {
        const blossomServers = await findBlossomServers(ndk, user, [
          ...(projectData?.servers || []),
          ...(options.servers?.split(",") || []),
        ]);

        const localFiles = await findAllLocalFiles(fileOrFolder);
        console.log(`${localFiles.length} files found locally in ${fileOrFolder}`);
        logFiles(localFiles, options);

        const onlineFiles = await findRemoteFiles(ndk, user.pubkey);
        console.log(`${onlineFiles.length} files available online.`);
        logFiles(onlineFiles, options);

        const { toTransfer, existing, toDelete } = await compareFileLists(localFiles, onlineFiles);
        console.log(
          `${toTransfer.length} new files to upload, ${existing.length} files unchanged, ${toDelete.length} files to delete online.`,
        );

        if (options.force) {
          // If force option is selected, add all existing files to be uploaded again
          toTransfer.push(...existing);
        }

        if (toTransfer.length > 0) {
          await processUploads(ndk, toTransfer, blossomServers, signEventTemplate);
        }
        logFiles(toTransfer, options);

        if (options.purge) {
          for await (const file of toDelete) {
            if (file.event) {
              const deleteAuth = await BlossomClient.getDeleteAuth(file.sha256, signEventTemplate);
              for await (const s of blossomServers) {
                try {
                  // TODO how can we make sure we are not deleting blobs that are
                  // used otherwise!?
                  await BlossomClient.deleteBlob(s, file.sha256, deleteAuth);
                  log(`Deleted blob ${file.sha256} from server ${s}.`);
                } catch (e) {
                  console.error(`Error deleting blob ${file.sha256} from server ${s}:`, e);
                }
              }
              file.event.delete();
            }
          }
        }

        process.exit(0);
      } catch (error) {
        log("Failed to fetch online files:", error);
      }
    },
  );

// Command: list all files available online
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
    const privateKey = npub || options.privatekey || NOSTR_PRIVATE_KEY || projectData?.privateKey;
    if (!privateKey) {
      console.error("No private key found. Please set up a new project or specify a private key with --privatekey.");
      process.exit(1);
    }
    const user = await initNdk(privateKey, [...(projectData?.relays || []), ...(options.relays?.split(",") || [])]);

    if (!ndk) return;

    log("Listing web content for " + (npub || user.npub));
    const onlineFiles = await findRemoteFiles(ndk, optionalPubKey || user.pubkey);
    logFiles(onlineFiles, { verbose: true });

    process.exit(0);
  });

// Command: list all files available online
program
  .command("download")
  .argument("<targetfolder>", "The folder where the files should be downloaded to.")
  .argument("<npub>", "The public key (npub) of web content to download from.")
  .option("-s, --servers <servers>", "The blossom servers to use (comma separated).", undefined)
  .option("-r, --relays <relays>", "The NOSTR relays to use (comma separated).", undefined)
  .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
  // TODO maybe add --watch option to watch for changes and re-download
  .description("Download all files available online")
  .action(
    async (targetFolder: string, npub: string, options: { servers?: string; relays?: string; verbose: boolean }) => {
      //    const projectData = await setupProject();
      //  if (!projectData.privateKey) return; // TODO handle error
      // TODO allow use without a private key (npub only)
      debug(`download to ${targetFolder} from ${npub}`);

      const user = await initNdk(npub, [...(options.relays?.split(",") || [])]);
      if (!ndk) return; // TODO handle error

      const blossomServers = await findBlossomServers(ndk, user, [...(options.servers?.split(",") || [])]);

      const optionalPubKey = npub && (nip19.decode(npub).data as string);
      log("Downloading web content for " + (npub || user.npub));
      const onlineFiles = await findRemoteFiles(ndk, optionalPubKey || user.pubkey);
      logFiles(onlineFiles, options);

      const localFiles = await findAllLocalFiles(targetFolder);
      console.log(`${localFiles.length} files found locally in ${targetFolder}`);
      logFiles(localFiles, options);

      const { toTransfer, existing, toDelete } = await compareFileLists(onlineFiles, localFiles);
      console.log(
        `${toTransfer.length} new files to download, ${existing.length} files unchanged, ${toDelete.length} files to delete locally.`,
      );

      for (const file of toTransfer) {
        const filePath = path.join(targetFolder, file.remotePath);
        const dir = path.dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        let downloadSuccess = false; // Track if download was successful
        for (const server of blossomServers) {
          // Loop through all servers
          try {
            const content = await BlossomClient.getBlob(server, file.sha256);
            writeFileSync(filePath, Buffer.from(await content.arrayBuffer()));
            log(`Downloaded ${file.remotePath} to ${filePath} from server ${server}`);
            downloadSuccess = true; // Mark as successful
            break; // Exit loop on success
          } catch (error) {
            log(`Failed to download ${file.remotePath} from server ${server}: ${error}`);
          }
        }
        if (!downloadSuccess) {
          log(`All attempts to download ${file.remotePath} failed.`);
        }
      }

      process.exit(0);
    },
  );

program.action(async (cmdObj) => {
  const projectData = await setupProject();
  if (projectData.privateKey)
    console.log(
      `Project is set up with private key, ${projectData.relays.length} relays and ${projectData.servers.length} blossom servers.`,
    );
  program.help();
});

program.parse(process.argv);
