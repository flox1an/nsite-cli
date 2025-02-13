#!/usr/bin/env node
import "./polyfill.js";
import { Command } from "commander";
import debug from "debug";
import { setupProject } from "./setup-project.js";
import registerUploadCommand from "./commands/upload.js";
import registerLsCommand from "./commands/ls.js";
import registerDownloadCommand from "./commands/download.js";

const log = debug("nsite");
const program = new Command("nsite-cli");

// Register each command with the program
registerUploadCommand(program);
registerLsCommand(program);
registerDownloadCommand(program);

// Fallback action (e.g. show help or project info)
program.action(async () => {
  const projectData = await setupProject();
  if (projectData.privateKey)
    console.log(
      `Project is set up with private key, ${projectData.relays.length} relays and ${projectData.servers.length} blossom servers.`,
    );
  program.help();
});

program.parse(process.argv);
