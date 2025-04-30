#!/usr/bin/env node
import "./polyfill.js";

import { Command } from "commander";

import { colors } from "./colors.js";
import { setupProject } from "./setup-project.js";

import registerDownloadCommand from "./commands/download.js";
import registerLsCommand from "./commands/ls.js";
import registerUploadCommand from "./commands/upload.js";

const program = new Command("nsite-cli");

// Register each command with the program
registerUploadCommand(program);
registerLsCommand(program);
registerDownloadCommand(program);

program.action(async () => {
  const projectData = await setupProject();
  if (projectData.privateKey)
    console.log(
      `Project is set up with private key, ${colors.count(projectData.relays.length)} relays and ${colors.count(projectData.servers.length)} blossom servers.`,
    );
  program.help();
});

program.parse(process.argv);
