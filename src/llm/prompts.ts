import fs from "fs";
import path from "path";

const cache = new Map<string, string>();

export function loadPrompt(name: string) {
  if (cache.has(name)) {
    return cache.get(name)!;
  }
  const promptPath = path.join(process.cwd(), "prompts", name);
  const content = fs.readFileSync(promptPath, "utf8");
  cache.set(name, content);
  return content;
}

export function renderPrompt(template: string, values: Record<string, string>) {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{${key}}`, value);
  }
  return output;
}
