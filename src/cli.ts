#!/usr/bin/env node
import { WebSocket } from "ws";
global.WebSocket = global.WebSocket || WebSocket;

import { Command } from "commander";
import { listRemoteFiles as findRemoteFiles, publishBlossomServerList } from "./nostr.js";
import { compareFiles as compareFileLists, getAllFiles as findAllLocalFiles } from "./files.js";
import { processUploads } from "./upload.js";
import NDK, { NDKEvent, NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { BLOSSOM_SERVERS, NOSTR_PRIVATE_KEY, NOSTR_RELAYS } from "./env.js";
import { nip19 } from "nostr-tools";
import {
  areServersEqual,
  BlossomClient,
  EventTemplate,
  getServersFromServerListEvent,
  SignedEvent,
  USER_BLOSSOM_SERVER_LIST_KIND,
} from "blossom-client-sdk";
import path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readProjectFile, writeProjectFile } from "./config.js";
import { createInterface } from "readline/promises";
import { bytesToHex } from "@noble/hashes/utils";
import debug from "debug";

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
  const uniqueRelays = new Set([...relays, ...NOSTR_RELAYS]);
  ndk = new NDK({
    explicitRelayUrls: [...uniqueRelays.values()],
  });

  const signer = new NDKPrivateKeySigner(privateKey);
  signer.blockUntilReady();
  const user = await signer.user();
  // console.log(`Using npub: ${user.npub}`);
  ndk.signer = signer;
  await ndk.connect();

  return user;
}

const program = new Command("nsite-cli");

// TODO add rate limiting for certain relays

// Command: upload files
program
  .command("upload")
  .description("Upload files from a directory")
  .argument("<file-or-folder>", "The file or folder that should be published.")
  .option("-f, --force", "Force publishing even if no changes were detected.", false)
  .option("-p, --purge", "Delete online file events that are not used anymore.", false)
  .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
  .action(
    async (
      fileOrFolder: string,
      { force: optForce, verbose: optVerbose, purge: optPurge }: { force: boolean; verbose: boolean; purge: boolean },
    ) => {
      const projectData = readProjectFile();
      if (!projectData?.privateKey) return; // TODO handle generate
      const user = await initNdk(projectData?.privateKey, projectData?.relays);

      if (!ndk) return;

      const pool = ndk.outboxPool || ndk.pool;
      console.log("Using relays: ", [...pool.relays.values()].map((r) => r.url).join(", "));

      try {
        const blossomServerEvent = await ndk.fetchEvent([
          { kinds: [USER_BLOSSOM_SERVER_LIST_KIND], authors: [user.pubkey] },
        ]);
        const publicBlossomServers = blossomServerEvent
          ? getServersFromServerListEvent(blossomServerEvent).map((u) => u.toString())
          : [];

        const blossomServers = [...publicBlossomServers];

        // merge with servers from config/environment
        for (const bs of [...BLOSSOM_SERVERS, ...projectData.servers]) {
          if (!blossomServers.find((i) => areServersEqual(i, bs))) {
            blossomServers.push(bs);
          }
        }

        if (publicBlossomServers.length < blossomServers.length) {
          log("Publishing blossom server list...");
          await publishBlossomServerList(ndk, user.pubkey, blossomServers);
        }

        if (blossomServers.length == 0) throw new Error("No blossom servers found");

        console.log("Using blossom servers: " + blossomServers.join(", "));

        const localFiles = await findAllLocalFiles(fileOrFolder);
        console.log(`${localFiles.length} files found locally in ${fileOrFolder}`);
        if (optVerbose) {
          log(localFiles.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));
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
          await processUploads(ndk, toUpload, blossomServers, signEventTemplate);
        }

        if (optVerbose) {
          console.log(toUpload.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));
        }

        if (optPurge) {
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
  .description("List all files available online")
  .action(async (npub?: string) => {
    const projectData = await setupProject();
    if (!projectData.privateKey) return; // TODO handle error

    const user = await initNdk(projectData.privateKey, projectData.relays);
    if (!ndk) return; // TODO handle error

    const optionalPubKey = npub && (nip19.decode(npub).data as string);
    log("Listing web content for " + (npub || user.npub));
    const onlineFiles = await findRemoteFiles(ndk, optionalPubKey || user.pubkey);
    console.log(onlineFiles.map((f) => `${f.sha256}\t${f.changedAt}\t${f.remotePath}`).join("\n"));

    process.exit(0);
  });

async function onboarding() {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let privateKey: string;
  const existingKey = await readline.question(
    "\n1. Existing NOSTR private key (nsec/hex) or press Enter to create a NEW one:\n",
  );

  if (existingKey.trim()) {
    if (existingKey.startsWith("nsec1")) {
      privateKey = bytesToHex(nip19.decode(existingKey).data as Uint8Array);
    } else {
      privateKey = existingKey.trim();
    }

    log("Using provided private key.");
  } else {
    const signer = NDKPrivateKeySigner.generate();
    privateKey = signer.privateKey!;
    log("Generated new private key.");
  }

  try {
    const signer = new NDKPrivateKeySigner(privateKey);
    const user = await signer.user();
    log("Using npub: " + user.npub);
  } catch (e) {
    log("Invalid private key!");
    process.exit(1);
  }

  const askForList = async (prompt: string): Promise<string[]> => {
    console.log(prompt);
    const list: string[] = [];
    while (true) {
      const input = await readline.question("");
      if (input.trim() === "") break;
      list.push(input.trim());
    }
    return list;
  };

  const relays = await askForList("\n2. Enter multiple NOSTR relay URLs (e.g. wss://nos.lol) Press Enter to finish:");
  const servers = await askForList(
    "3. Enter multiple blossom server URLs (e.g. https://cdn.satellite.earth) Press Enter to finish:",
  );

  readline.close();

  const projectData = { privateKey, relays, servers: servers };
  writeProjectFile(projectData);
}

async function setupProject() {
  let projectData = readProjectFile();
  if (!projectData) {
    console.log("nsite-cli: No existing project configuration found. Setting up a new one:");
    await onboarding();
    projectData = readProjectFile();
  }

  if (!projectData || !projectData.privateKey) {
    console.error("Project data not found. Use nsite-cli genrate to set up a new project.");
    process.exit(1);
  }

  return projectData;
}

program.action(async (cmdObj) => {
  const projectData = await setupProject();
  if (projectData.privateKey)
    console.log(
      `Project is set up with private key, ${projectData.relays.length} relays and ${projectData.servers.length} blossom servers.`,
    );
  program.help();
});

program.parse(process.argv);
