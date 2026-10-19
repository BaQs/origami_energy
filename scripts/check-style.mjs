// Fails on wording and formatting typical of generated text. Run with `npm run check`.
// Adapted from hazymorning/origami_header (MIT).
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const skip = new Set([".git", "node_modules", "test-results", "playwright-report", "theme.local.css"]);
const types = new Set([".md", ".js", ".mjs", ".json", ".yaml", ".yml", ".html"]);
const self = "scripts/check-style.mjs";

const phrases = [
  "seamless", "seamlessly", "leverage", "leverages", "leveraging", "robust", "delve", "elevate", "unlock", "empower",
  "supercharge", "revolutionize", "revolutionary", "game-changer", "game changer", "cutting-edge", "state-of-the-art",
  "next-level", "world-class", "best-in-class", "effortless", "effortlessly", "streamline", "streamlined", "blazing",
  "unleash", "harness the power", "comprehensive", "furthermore", "moreover", "in conclusion", "worth noting",
  "in today's", "dive into", "look no further", "whether you're", "take your", "powerful", "beautiful", "stunning",
  "sleek", "magic", "magical", "ultimate", "simply", "just works", "out of the box", "out-of-the-box",
];
const phrase = new RegExp(`\\b(${phrases.map((p) => p.replace(/[-']/g, "\\$&")).join("|")})\\b`, "i");
const small = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const names = /Home Assistant|Music Assistant|Origami (Energy|Music|Security|Header)|Origami|GitHub|HACS|YAML|CSS|AI|EZVIZ|SIA/g;

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : types.has(extname(entry.name)) ? [path] : [];
  });

const titleCase = (text) => {
  const words = text.replace(names, "").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  return words.length >= 3 && words.slice(1).every((w) => small.has(w.toLowerCase()) || /^[A-Z]/.test(w));
};

const problems = [];
for (const path of files(root)) {
  const name = relative(root, path);
  if (name === self) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  const report = (i, message) => problems.push(`${name}:${i + 1}: ${message}`);
  const markdown = name.endsWith(".md");
  let fence = false;

  lines.forEach((line, i) => {
    if (/\p{Extended_Pictographic}/u.test(line)) report(i, "emoji");
    if (line.includes("\u2014")) report(i, "em dash");
    if (markdown && /^\s*(```|~~~)/.test(line)) fence = !fence;
    if (markdown && fence) return;
    const text = markdown ? line.replace(/`[^`]*`/g, "") : line;
    const word = text.match(phrase);
    if (word) report(i, `"${word[1]}"`);
    if (!markdown) return;
    if (/!(\s|$)/.test(text.replace(/!\[/g, ""))) report(i, "exclamation mark");
    if (/^\s*[-*]\s+\*\*[^*]+\*\*/.test(text)) report(i, "bold lead-in bullet");
    const heading = text.match(/^#{1,6}\s+(.*)$/) || text.match(/<summary>(.*)<\/summary>/);
    if (heading && titleCase(heading[1])) report(i, "use sentence case in headings");
  });

  if (/\.m?js$/.test(name)) {
    if (lines.some((l) => l.includes("/**"))) report(0, "JSDoc block");
    const comments = lines.filter((l) => /^\s*\/\//.test(l)).length;
    if (lines.length > 50 && comments / lines.length > 0.1) report(0, `${comments} comment lines in ${lines.length}, keep comments for non-obvious things`);
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
