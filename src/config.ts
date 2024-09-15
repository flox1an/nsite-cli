import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

type ProjectData = { privateKey?: string; relays: string[]; servers: string[] };

const configDir = ".nsite";
const projectFile = "project.json";

export function writeProjectFile(projectData: ProjectData) {
  const projectPath = path.join(process.cwd(), configDir, projectFile);

  try {
    if (!existsSync(path.dirname(projectPath))) {
      mkdirSync(path.dirname(projectPath), { recursive: true });
    }

    writeFileSync(projectPath, JSON.stringify(projectData, null, 2));
    console.log(`Project configuration saved to ${path.relative(process.cwd(), projectPath)}`);
  } catch (error) {
    console.error(`Failed to save project configuration: ${(error as Error).message}`);
  }
}

export function readProjectFile(): ProjectData | null {
  const projectPath = path.join(process.cwd(), configDir, projectFile);

  try {
    if (!existsSync(projectPath)) {
      console.log(`Project file not found at ${path.relative(process.cwd(), projectPath)}`);
      return null;
    }

    const fileContent = readFileSync(projectPath, "utf-8");
    const projectData: ProjectData = JSON.parse(fileContent);
    return projectData;
  } catch (error) {
    console.error(`Failed to read project file: ${(error as Error).message}`);
    return null;
  }
}
