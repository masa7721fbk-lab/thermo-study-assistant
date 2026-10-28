import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
const [template, css, app, materials, api] = await Promise.all([
  readFile("worker/page.html", "utf8"), readFile("worker/style.css", "utf8"),
  readFile("worker/app.js", "utf8"), readFile("worker/materials.json", "utf8"),
  readFile("worker/api.js", "utf8"),
]);
const page = template.replace("<!-- APP_STYLE -->", `<style>${css}</style>`).replace("<!-- APP_SCRIPT -->", `<script>${app}</script>`);
const source = `const page = ${JSON.stringify(page)};\nconst MATERIAL = ${JSON.stringify(JSON.parse(materials))};\n${api}`;
await writeFile("worker/index.js", source, "utf8");
await mkdir("dist/server", { recursive: true }); await mkdir("dist/.openai", { recursive: true });
await copyFile("worker/index.js", "dist/server/index.js"); await mkdir("dist/.openai", { recursive: true }); await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
console.log("Built dist/");
