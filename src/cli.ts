#!/usr/bin/env node
import "./polyfill.js";

import NDK, { NDKEvent, NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { BlossomClient, EventTemplate, SignedEvent } from "blossom-client-sdk";
import { Command } from "commander";
import debug from "debug";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { copyFile } from "fs/promises";
import { nip19 } from "nostr-tools";
import path from "path";

import { findBlossomServers } from "./blossom.js";
import { colors, formatFileStatus } from "./colors.js";
import { readProjectFile } from "./config.js";
import { NOSTR_PRIVATE_KEY, NOSTR_RELAYS } from "./env.js";
import { compareFiles as compareFileLists, getLocalFiles as findAllLocalFiles } from "./files.js";
import { broadcastRelayList, listRemoteFiles as findRemoteFiles, Profile, publishProfile } from "./nostr.js";
import { setupProject } from "./setup-project.js";
import { FileList } from "./types.js";
import { processUploads } from "./upload.js";

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
  ndk = new NDK({ explicitRelayUrls: uniqueRelays });

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
          return `${f.sha256}\t${date}\t${colors.filePath(f.remotePath)}`;
        })
        .join("\n"),
    );
  }
}

const program = new Command("nsite-cli");

// Register each command with the program
registerUploadCommand(program);
registerLsCommand(program);
registerDownloadCommand(program);

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
  .option("-c, --concurrency <number>", "Number of concurrent uploads (default: 5)", "5")
  .option("--publish-server-list", "Publish the list of blossom servers (Kind 10063).", false)
  .option("--publish-relay-list", "Publish the list of NOSTR relays (Kind 10002).", false)
  .option("--publish-profile", "Publish the app profile for the npub (Kind 0).", false)
  .option("--fallback", "an html file to copy and publish as 404.html")

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
        fallback?: string;
        concurrency?: string;
        publishServerList: boolean;
        publishRelayList: boolean;
        publishProfile: boolean;
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
      console.log(`Upload for user:      ${colors.emphasis(user.npub)}`);

      const pool = ndk.outboxPool || ndk.pool;
      const relayUrls = [...pool.relays.values()].map((r) => r.url);
      console.log(`Using relays:         ${colors.emphasis(relayUrls.join(", "))}`);

      if (options.publishRelayList || projectData?.publishRelayList) {
        console.log("Publishing relay list (Kind 10002)...");
        await broadcastRelayList(ndk, relayUrls, relayUrls);
      }

      if (projectData?.profile && (options.publishProfile || projectData?.publishProfile)) {
        // TODO check if any profile settings have changed!?
        console.log("Publishing profile (Kind 0)...");
        const { name, about, nip05, picture } = projectData?.profile;
        await publishProfile(ndk, { name, display_name: name, about, nip05, picture } as Profile);
      }

      try {
        const publishBlossomServerList = options.publishServerList || projectData?.publishServerList || false;
        const blossomServers = await findBlossomServers(ndk, user, publishBlossomServerList, [
          ...(projectData?.servers || []),
          ...(options.servers?.split(",") || []),
        ]);

        const fallbackFor404 = options.fallback || projectData?.fallback;
        if (fallbackFor404) {
          const sourceFolder = fileOrFolder.replace(/\/+$/, "");
          const htmlSourcePath = `${sourceFolder}/${fallbackFor404.replace(/^\/+/, "")}`;
          const fallback404Path = `${sourceFolder}/404.html`;
          log(`copying 404 fallback from '${htmlSourcePath}' to '${fallback404Path}'`);
          await copyFile(htmlSourcePath, fallback404Path);
        }

        const localFiles = await findAllLocalFiles(fileOrFolder);
        if (localFiles.length == 0) throw new Error(`No files found in local source folder ${fileOrFolder}.`);

        // TODO show file size for all files
        console.log(`${colors.count(localFiles.length)} files found locally in ${colors.filePath(fileOrFolder)}`);
        logFiles(localFiles, options);

        const onlineFiles = await findRemoteFiles(ndk, user.pubkey);
        console.log(`${colors.count(onlineFiles.length)} files available online.`);
        logFiles(onlineFiles, options);

        const { toTransfer, existing, toDelete } = await compareFileLists(localFiles, onlineFiles);
        console.log(
          `${colors.count(toTransfer.length)} new files to upload, ${colors.count(existing.length)} files unchanged, ${colors.count(toDelete.length)} files to delete online.`,
        );

        if (options.force) {
          // If force option is selected, add all existing files to be uploaded again
          toTransfer.push(...existing);
        }

        if (toTransfer.length > 0) {
          await processUploads(ndk, toTransfer, blossomServers, signEventTemplate, {
            concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 5,
          });
        }
        logFiles(toTransfer, options);

        // TODO add an age option to only delete files that were changed before that date
        if (options.purge) {
          for await (const file of toDelete) {
            if (file.event) {
              const deleteAuth = await BlossomClient.createDeleteAuth(signEventTemplate, file.sha256);
              for await (const s of blossomServers) {
                try {
                  // TODO how can we make sure we are not deleting blobs that are
                  // used otherwise!?
                  console.log(
                    `${colors.error("Deleting")} blob ${colors.filePath(file.sha256)} from server ${colors.emphasis(s)}.`,
                  );
                  await BlossomClient.deleteBlob(s, file.sha256, { auth: deleteAuth });
                } catch (e) {
                  console.error(`Error deleting blob ${file.sha256} from server ${s}`);
                }
              }

              try {
                console.log(
                  `${colors.error("Deleting")} event ${colors.filePath(file.event?.id || "")} from the relays.`,
                );
                const deletionEvent = await file.event.delete("File deletion through sync with nsite-cli.", true);
                log(`Published deletion event ${deletionEvent.id}`);
              } catch (e) {
                console.error(`Error deleting event ${file.event?.id} from the relays.`);
              }
            }
          }
        }

        console.log(
          `\n${colors.header("Success!")} The website is now available on any nsite gateway, e.g.: ${colors.url(`https://${user.npub}.nsite.lol`)}`,
        );

        process.exit(0);
      } catch (error) {
        console.error(`${colors.error("Failed to fetch online files:")} ${error}`);
        process.exit(1);
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

    console.log(`${colors.header("Listing web content for:")} ${colors.emphasis(npub || user.npub)}`);
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

      const blossomServers = await findBlossomServers(ndk, user, false, [...(options.servers?.split(",") || [])]);

      const optionalPubKey = npub && (nip19.decode(npub).data as string);
      console.log(`${colors.header("Downloading web content for:")} ${colors.emphasis(npub || user.npub)}`);
      const onlineFiles = await findRemoteFiles(ndk, optionalPubKey || user.pubkey);
      logFiles(onlineFiles, options);

      const localFiles = await findAllLocalFiles(targetFolder);
      console.log(`${colors.count(localFiles.length)} files found locally in ${colors.filePath(targetFolder)}`);
      logFiles(localFiles, options);

      const { toTransfer, existing, toDelete } = await compareFileLists(onlineFiles, localFiles);
      console.log(
        `${colors.count(toTransfer.length)} new files to download, ${colors.count(existing.length)} files unchanged, ${colors.count(toDelete.length)} files to delete locally.`,
      );

      console.log(colors.header("\nDownloading files:"));
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
            const content = await BlossomClient.downloadBlob(server, file.sha256);
            writeFileSync(filePath, Buffer.from(await content.arrayBuffer()));
            console.log(
              formatFileStatus(file.remotePath, colors.success("✓ Downloaded"), `from ${colors.emphasis(server)}`),
            );
            downloadSuccess = true; // Mark as successful
            break; // Exit loop on success
          } catch (error) {
            log(`Failed to download ${file.remotePath} from server ${server}: ${error}`);
          }
        }
        if (!downloadSuccess) {
          console.log(formatFileStatus(file.remotePath, colors.error("✗ Failed"), "No servers available"));
        }
      }

      console.log(colors.header("\nDownload Summary:"));
      console.log(`- Total files: ${colors.count(toTransfer.length)}`);
      const successfulCount =
        toTransfer.length - toTransfer.filter((f) => !existsSync(path.join(targetFolder, f.remotePath))).length;
      console.log(`- Successfully downloaded: ${colors.success(successfulCount)}`);
      console.log(`- Failed: ${colors.error(toTransfer.length - successfulCount)}`);
      process.exit(0);
    },
  );

program.action(async (cmdObj) => {
  const projectData = await setupProject();
  if (projectData.privateKey)
    console.log(
      `Project is set up with private key, ${colors.count(projectData.relays.length)} relays and ${colors.count(projectData.servers.length)} blossom servers.`,
    );
  program.help();
});

program.parse(process.argv);
