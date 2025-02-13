import { Command } from "commander";
import { copyFile } from "fs/promises";
import debug from "debug";
import { NDKEvent, NDKUser } from "@nostr-dev-kit/ndk";
import { BlossomClient } from "blossom-client-sdk";
import { broadcastRelayList, listRemoteFiles as findRemoteFiles, Profile, publishProfile } from "../nostr.js";
import { compareFiles as compareFileLists, getLocalFiles as findAllLocalFiles } from "../files.js";
import { processUploads } from "../upload.js";
import { readProjectFile } from "../config.js";
import { findBlossomServers } from "../blossom.js";

import { initNdk, signEventTemplate, logFiles, getNDK } from "./common.js";

const log = debug("nsite");
const logSign = debug("nsite:sign");

export default function registerUploadCommand(program: Command) {
  program
    .command("upload")
    .description("Upload files from a directory")
    .argument("<folder>", "The folder that should be published.")
    .option("-f, --force", "Force publishing even if no changes were detected.", false)
    .option("-s, --servers <servers>", "The blossom servers to use (comma separated).", undefined)
    .option("-r, --relays <relays>", "The NOSTR relays to use (comma separated).", undefined)
    .option("-k, --privatekey <nsec>", "The private key (nsec/hex) to use for signing.", undefined)
    .option("-p, --purge", "Delete online file events that are not used anymore.", false)
    .option("-v, --verbose", "Verbose output, i.e. print lists of files uploaded.")
    .option("--publish-server-list", "Publish the list of blossom servers (Kind 10063).", false)
    .option("--publish-relay-list", "Publish the list of NOSTR relays (Kind 10002).", false)
    .option("--publish-profile", "Publish the app profile for the npub (Kind 0).", false)
    .option("--fallback", "An HTML file to copy and publish as 404.html")
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
          publishServerList: boolean;
          publishRelayList: boolean;
          publishProfile: boolean;
        },
      ) => {
        log("upload called", options);
        const projectData = readProjectFile();

        const privateKey = options.privatekey || projectData?.privateKey;
        if (!privateKey) {
          console.error(
            "No private key found. Please set up a new project or specify a private key with --privatekey.",
          );
          process.exit(1);
        }
        const user: NDKUser = await initNdk(privateKey, [
          ...(projectData?.relays || []),
          ...(options.relays?.split(",") || []),
        ]);

        if (!getNDK()) return;
        console.log("Upload for user:      ", user.npub);

        const pool = getNDK()!.outboxPool || getNDK()!.pool;
        const relayUrls = [...pool.relays.values()].map((r) => r.url);
        console.log("Using relays:         ", relayUrls.join(", "));

        if (options.publishRelayList || projectData?.publishRelayList) {
          console.log("Publishing relay list (Kind 10002)...");
          await broadcastRelayList(getNDK()!, relayUrls, relayUrls);
        }

        if (projectData?.profile && (options.publishProfile || projectData?.publishProfile)) {
          console.log("Publishing profile (Kind 0)...");
          const { name, about, nip05, picture } = projectData.profile;
          await publishProfile(getNDK()!, {
            name,
            display_name: name,
            about,
            nip05,
            picture,
          } as Profile);
        }

        try {
          const publishBlossomServerList = options.publishServerList || projectData?.publishServerList || false;
          const blossomServers = await findBlossomServers(getNDK()!, user, false, publishBlossomServerList, [
            ...(projectData?.servers || []),
            ...(options.servers?.split(",") || []),
          ]);

          const fallbackFor404 = options.fallback || projectData?.fallback;
          if (fallbackFor404) {
            const sourceFolder = fileOrFolder.replace(/\/+$/, "");
            const htmlSourcePath = `${sourceFolder}/${fallbackFor404.replace(/^\/+/, "")}`;
            const fallback404Path = `${sourceFolder}/404.html`;
            log(`Copying 404 fallback from '${htmlSourcePath}' to '${fallback404Path}'`);
            await copyFile(htmlSourcePath, fallback404Path);
          }

          const localFiles = await findAllLocalFiles(fileOrFolder);
          if (localFiles.length === 0) throw new Error(`No files found in local source folder ${fileOrFolder}.`);

          console.log(`${localFiles.length} files found locally in ${fileOrFolder}`);
          logFiles(localFiles, options);

          const onlineFiles = await findRemoteFiles(getNDK()!, user.pubkey);
          console.log(`${onlineFiles.length} files available online.`);
          logFiles(onlineFiles, options);

          const { toTransfer, existing, toDelete } = await compareFileLists(localFiles, onlineFiles);
          console.log(
            `${toTransfer.length} new files to upload, ${existing.length} files unchanged, ${toDelete.length} files to delete online.`,
          );

          if (options.force) {
            toTransfer.push(...existing);
          }

          if (toTransfer.length > 0) {
            await processUploads(getNDK()!, toTransfer, blossomServers, signEventTemplate);
          }
          logFiles(toTransfer, options);

          if (options.purge) {
            for await (const file of toDelete) {
              if (file.event) {
                const deleteAuth = await BlossomClient.createDeleteAuth(signEventTemplate, file.sha256);
                for await (const s of blossomServers) {
                  try {
                    console.log(`Deleting blob ${file.sha256} from server ${s}.`);
                    await BlossomClient.deleteBlob(s, file.sha256, { auth: deleteAuth });
                  } catch (e) {
                    console.error(`Error deleting blob ${file.sha256} from server ${s}`, e);
                  }
                }

                try {
                  console.log(`Deleting event ${file.event?.id} from the relays.`);
                  const deletionEvent: NDKEvent = await file.event.delete(
                    "File deletion through sync with nsite-cli.",
                    true,
                  );
                  log(`Published deletion event ${deletionEvent.id}`);
                } catch (e) {
                  console.error(`Error deleting event ${file.event?.id} from the relays.`, e);
                }
              }
            }
          }

          console.log(`The website is now available on any nsite gateway, e.g.: https://${user.npub}.nsite.lol`);

          process.exit(0);
        } catch (error) {
          console.error("Failed to fetch online files:", error);
          process.exit(1);
        }
      },
    );
}
