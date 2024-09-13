import { WebSocket } from "ws";
global.WebSocket = global.WebSocket || WebSocket;

import { Command } from "commander";
import ndk from "./ndk.js";
import { listRemoteFiles as findRemoteFiles } from "./nostr.js";
import { compareFiles as compareFileLists, getAllFiles as findAllLocalFiles } from "./files.js";
import { processUploads } from "./upload.js";
import { NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { NOSTR_PRIVATE_KEY } from "./env.js";
import { nip19 } from "nostr-tools";

let user: NDKUser;

if (NOSTR_PRIVATE_KEY) {
  const signer = new NDKPrivateKeySigner(NOSTR_PRIVATE_KEY);
  signer.blockUntilReady();
  user = await signer.user();
  console.log(`npub: ${user.npub}`);
  ndk.signer = signer;
}

const program = new Command();

// Command: upload files
program
  .command("upload")
  .description("Upload files from a directory")
  .argument("<file-or-folder>", "The file or folder that should be published.")
  .option("-u, --url <serverUrl>", "Server URL to upload files to")
  .option("--max-size <size>", "Maximum file size in bytes to upload in MB", (value) => parseInt(value), 50)
  .action(async (fileOrFolder: string, options) => {
    try {
      const localFiles = await findAllLocalFiles(fileOrFolder);
      console.log(`${localFiles.length} files found locally in ${fileOrFolder}`);

      const onlineFiles = await findRemoteFiles(ndk, user.pubkey);
      console.log(`${onlineFiles.length} files available online:`);

      //onlineFiles=[]; // TODO DEBUGGGONG

      const { toUpload, existing, toDelete } = await compareFileLists(localFiles, onlineFiles);
      console.log(
        `${toUpload.length} new files to upload, ${existing.length} files, ${toDelete.length} files to delete online.`,
      );

      if (toUpload.length > 0) {
        await processUploads(toUpload);
      }

      //console.log(onlineFiles.map(f => `${f.x}\t${f.changedAt}\t${f.file}`).join('\n'));
      //process.exit(0);
    } catch (error) {
      console.error("Failed to fetch online files:", error);
    }
  });

// Command: list all files available online
program
  .command("ls")
  .argument("[npub]", "The public key (npub) of web content to list.")
  .description("List all files available online")
  .action(async (npub?: string) => {
    const optionalPubKey = npub && (nip19.decode(npub).data as string);
    console.log('Listing web content for ' + (npub || user.npub))
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
