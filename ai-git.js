import "dotenv/config";
import fs from "fs-extra";
import simpleGit from "simple-git";
import OpenAI from "openai";

const git = simpleGit();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const task = process.argv.slice(2).join(" ");

if (!task) {
  console.log('Usage: node ai-git.js "your task"');
  process.exit(1);
}

// 1. Get repo status
const status = await git.status();
const files = status.modified.concat(status.not_added);

// 2. Build context (limit for safety)
let context = "";

for (const file of files.slice(0, 5)) {
  try {
    const content = await fs.readFile(file, "utf8");
    context += `\n--- ${file} ---\n${content}\n`;
  } catch {}
}

// 3. Ask AI for a file edit plan (NOT a patch anymore)
const response = await client.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [
    {
      role: "system",
      content: `
You are a senior software engineer.

You must return ONLY valid JSON in this format:

{
  "file": "path/to/file",
  "content": "FULL updated file content"
}

Rules:
- Output ONLY JSON
- No markdown
- No explanations
- Always return complete file content (not diffs)
`
    },
    {
      role: "user",
      content: `
TASK:
${task}

CONTEXT:
${context}
`
    }
  ]
});

let result;

try {
  result = JSON.parse(response.choices[0].message.content);
} catch (err) {
  console.log("\n❌ AI did not return valid JSON");
  console.log(response.choices[0].message.content);
  process.exit(1);
}

console.log("\n--- AI FILE EDIT ---");
console.log("File:", result.file);

// 4. Write file safely
try {
  await fs.writeFile(result.file, result.content, "utf8");
  console.log("\n✅ File updated safely");
} catch (err) {
  console.log("\n❌ Failed writing file");
  console.log(err.message);
  process.exit(1);
}

// 5. Git commit flow (safe)
try {
  await git.add(".");
  await git.commit(task);
  await git.push();

  console.log("\n🚀 Changes committed and pushed");
} catch (err) {
  console.log("\n❌ Git commit failed");
  console.log(err.message);
}