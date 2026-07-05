import "dotenv/config";
import fs from "fs-extra";
import simpleGit from "simple-git";
import OpenAI from "openai";
import readline from "readline";
import { globSync } from "glob";

const git = simpleGit();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const task = process.argv.slice(2).join(" ");

if (!task) {
  console.log('Usage: node ai-git.js "your task"');
  process.exit(1);
}

function askYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question + " (y/n): ", answer => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

console.log("\n🔍 Scanning real project files...\n");

// 🚨 REAL FILE DISCOVERY (this fixes EVERYTHING)
const files = globSync("**/*", {
  ignore: [
    "node_modules/**",
    ".git/**",
    ".env",
    "**/*.lock"
  ],
  nodir: true
});

console.log("📁 Files found:");
console.log(files.slice(0, 30));

// Read small context only
let context = "";

for (const file of files.slice(0, 10)) {
  try {
    const content = await fs.readFile(file, "utf8");
    context += `\n--- ${file} ---\n${content}\n`;
  } catch {}
}

// 🚨 CRITICAL: AI must pick ONLY from this list
const response = await client.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [
    {
      role: "system",
      content: `
You are a senior software engineer working inside a real codebase.

YOU MUST FOLLOW THESE RULES:
- You can ONLY edit files from this list:
${files.join("\n")}

- NEVER invent file paths
- NEVER create new files
- If no file fits, return null

Return ONLY valid JSON:

{
  "file": "exact path from list",
  "content": "FULL updated file content"
}
`
    },
    {
      role: "user",
      content: `
TASK:
${task}

CODE CONTEXT:
${context}
`
    }
  ]
});

let result;

try {
  result = JSON.parse(response.choices[0].message.content);
} catch (err) {
  console.log("\n❌ AI returned invalid JSON:");
  console.log(response.choices[0].message.content);
  process.exit(1);
}

// 🚨 VALIDATION (this prevents your current crash loop)
if (!result.file || !files.includes(result.file)) {
  console.log("\n🚫 Invalid or unknown file selected:");
  console.log(result.file);
  process.exit(1);
}

if (!result.content || result.content.length < 10) {
  console.log("\n🚫 Invalid file content");
  process.exit(1);
}

// PREVIEW
console.log("\n--- FILE TO MODIFY ---");
console.log(result.file);

console.log("\n--- PREVIEW ---");
console.log(result.content.slice(0, 800));

const confirm = await askYesNo("\nApply this change?");
if (!confirm) {
  console.log("❌ Cancelled");
  process.exit(0);
}

// WRITE
await fs.writeFile(result.file, result.content, "utf8");

console.log("\n✅ File updated");

// COMMIT
try {
  await git.add(".");
  await git.commit(task);
  await git.push();
  console.log("\n🚀 Committed + pushed");
} catch (err) {
  console.log("\n❌ Git error:", err.message);
}