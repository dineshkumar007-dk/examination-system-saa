import yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { fail } from "../utils/security.js";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
export const MAX_UPLOAD = 3 * 1024 * 1024;
const xml = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
});
const plainXml = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
});
function parse(buffer, ordered = true) {
  const text = buffer.toString("utf8");
  if (text.length > 2 * 1024 * 1024)
    fail(400, "A slide XML part exceeds the safe text limit.");
  let depth = 0;
  for (const token of text.matchAll(/<[^>]*>/g)) {
    if (/^<\//.test(token[0])) depth--;
    else if (/^<[^!?/]/.test(token[0]) && !/\/>$/.test(token[0])) depth++;
    if (depth > 128)
      fail(400, "PowerPoint XML nesting exceeds the safe limit.");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    fail(400, "Invalid or unsafe PowerPoint XML.");
  return (ordered ? xml : plainXml).parse(text);
}
function nodes(tree, name, out = []) {
  if (Array.isArray(tree)) for (const item of tree) nodes(item, name, out);
  else if (tree && typeof tree === "object")
    for (const [key, value] of Object.entries(tree)) {
      if (key === name) out.push({ children: value, attrs: tree[":@"] || {} });
      if (key !== ":@") nodes(value, name, out);
    }
  return out;
}
function words(tree) {
  if (Array.isArray(tree)) return tree.map(words).join("");
  if (!tree || typeof tree !== "object") return "";
  return Object.entries(tree)
    .map(([key, val]) =>
      key === "#text"
        ? String(val)
        : key === "a:br"
          ? "\n"
          : key === ":@"
            ? ""
            : words(val),
    )
    .join("");
}
async function unzip(buffer) {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error)
          return reject(
            Object.assign(new Error("Invalid PPTX archive."), {
              status: 400,
              expose: true,
            }),
          );
        const files = new Map();
        let total = 0,
          count = 0,
          done = false;
        const abort = (e) => {
          if (done) return;
          done = true;
          zip.close();
          reject(e);
        };
        const invalid = (message) =>
          Object.assign(new Error(message), { status: 400, expose: true });
        zip.on("error", abort);
        zip.on("end", () => {
          if (!done) {
            done = true;
            resolve(files);
          }
        });
        zip.on("entry", (entry) => {
          if (
            ++count > 1500 ||
            entry.uncompressedSize > 10 * 1024 * 1024 ||
            (total += entry.uncompressedSize) > 24 * 1024 * 1024
          )
            return abort(
              invalid("PowerPoint exceeds the safe extraction limits."),
            );
          const name = entry.fileName;
          if (
            name.includes("..") ||
            name.startsWith("/") ||
            files.has(name) ||
            entry.generalPurposeBitFlag & 1
          )
            return abort(
              invalid("Unsafe, duplicate or encrypted archive entry."),
            );
          if (
            !name.endsWith("/") &&
            /vbaProject|ppt\/embeddings|activeX/i.test(name)
          )
            return abort(
              invalid(
                "Macros, embedded objects and ActiveX files are not supported.",
              ),
            );
          if (name.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err) return abort(err);
            let size = 0;
            const chunks = [];
            stream.on("error", abort);
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > entry.uncompressedSize || size > 10 * 1024 * 1024) {
                stream.destroy();
                abort(invalid("Archive size validation failed."));
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              if (done) return;
              files.set(name, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}
function relations(files, file) {
  if (!files.has(file)) return new Map();
  const rel = parse(files.get(file), false).Relationships?.Relationship;
  return new Map(
    (Array.isArray(rel) ? rel : rel ? [rel] : []).map((r) => [r["@_Id"], r]),
  );
}
function image(buffer) {
  const png = buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (!png && !jpeg)
    fail(
      400,
      "Only PNG/JPEG slide images are supported. Replace other image formats before uploading.",
    );
  if (buffer.length > 256 * 1024)
    fail(
      400,
      "A slide image exceeds 256 KB. Compress images before uploading.",
    );
  return {
    mime: png ? "image/png" : "image/jpeg",
    data: buffer.toString("base64"),
  };
}
export function extractQuestions(slides) {
  const questions = [],
    issues = [];
  let current = null;
  for (const slide of slides) {
    let meaningful = false;
    for (const raw of slide.lines) {
      const line = raw.replace(/^[•\u2022]\s*/, "").trim();
      if (!line) continue;
      const heading =
        line.match(/^(?:Question\s*|Q\s*)?(\d+)\s*[).:-]\s*(.+)$/i) ||
        line.match(/^(?:Question|Q)\s*(\d+)\s+(.+)$/i);
      const option = line.match(/^\(?([A-H])\s*[).:]\s*(.+)$/i);
      if (heading) {
        current = {
          number: Number(heading[1]),
          prompt: heading[2].trim(),
          options: [],
          media: [],
          slides: [slide.number],
          marks: 1,
          negativeMarks: 0,
          answer: null,
        };
        questions.push(current);
        meaningful = true;
      } else if (option && current) {
        current.options.push({
          id: option[1].toUpperCase(),
          text: option[2].trim(),
        });
        meaningful = true;
        if (!current.slides.includes(slide.number))
          current.slides.push(slide.number);
      } else if (
        current &&
        !/^(?:answer|correct\s*answer|key)\s*:/i.test(line)
      ) {
        if (current.options.length) current.options.at(-1).text += "\n" + line;
        else current.prompt += "\n" + line;
        meaningful = true;
        if (!current.slides.includes(slide.number))
          current.slides.push(slide.number);
      } else {
        issues.push({
          slide: slide.number,
          message: /^(?:answer|correct\s*answer|key)\s*:/i.test(line)
            ? "An answer-like annotation was ignored. Enter the key manually."
            : `Unassigned text: ${line.slice(0, 100)}`,
        });
      }
    }
    const owners = questions.filter((q) => q.slides.includes(slide.number));
    if (slide.media.length) {
      if (owners.length === 1) owners[0].media.push(...slide.media);
      else
        issues.push({
          slide: slide.number,
          message:
            "Images could not be unambiguously assigned to one question. Review and transcribe/split this slide.",
        });
    }
    if (!meaningful)
      issues.push({
        slide: slide.number,
        message: slide.media.length
          ? "Image-only slide: OCR is not performed. Transcribe this question or document its exclusion."
          : "Slide has no recognized question text. Review hidden/master/chart content.",
      });
    for (const message of slide.issues || [])
      issues.push({ slide: slide.number, message });
  }
  const seen = new Set();
  for (const q of questions) {
    if (seen.has(q.number))
      issues.push({
        slide: q.slides[0],
        message: `Duplicate question number ${q.number}.`,
      });
    seen.add(q.number);
    if (
      q.options.length < 2 ||
      new Set(q.options.map((o) => o.id)).size !== q.options.length
    )
      issues.push({
        slide: q.slides[0],
        message: `Question ${q.number} has missing or duplicate options.`,
      });
  }
  if (questions.length > 300)
    fail(400, "At most 300 questions per paper are supported.");
  return {
    questions,
    issues,
    slideCount: slides.length,
    resolutions: {},
    reviewed: false,
  };
}
async function convertLegacy(buffer) {
  if (!process.env.LIBREOFFICE_PATH)
    fail(
      415,
      "Legacy .ppt conversion is unavailable on this host. Save the file as .pptx in PowerPoint and upload it. A self-hosted operator may configure LIBREOFFICE_PATH.",
    );
  const base = path.resolve(tmpdir()),
    dir = await mkdtemp(path.join(base, "exampro-ppt-"));
  try {
    const profile = path.join(dir, "profile");
    await mkdir(profile);
    await writeFile(
      path.join(profile, "registrymodifications.xcu"),
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>',
    );
    await writeFile(path.join(dir, "source.ppt"), buffer);
    await promisify(execFile)(
      process.env.LIBREOFFICE_PATH,
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--convert-to",
        "pptx",
        "--outdir",
        dir,
        path.join(dir, "source.ppt"),
      ],
      { timeout: 20000, maxBuffer: 4096, windowsHide: true },
    );
    const converted = await readFile(path.join(dir, "source.pptx"));
    if (converted.length > MAX_UPLOAD)
      fail(413, "Converted PPTX exceeds 3 MB.");
    return converted;
  } catch (e) {
    if (e.expose) throw e;
    fail(422, "Legacy conversion failed. Save as PPTX and try again.");
  } finally {
    const resolved = path.resolve(dir);
    if (
      resolved.startsWith(base + path.sep) &&
      path.basename(resolved).startsWith("exampro-ppt-")
    )
      await rm(resolved, { recursive: true, force: true });
  }
}
export async function parsePowerPoint(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_UPLOAD)
    fail(413, "Upload a nonempty PowerPoint file no larger than 3 MB.");
  const ext = path.extname(filename).toLowerCase();
  if (![".pptx", ".ppt"].includes(ext))
    fail(415, "Upload a .pptx or supported .ppt file.");
  if (ext === ".ppt") {
    if (!buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")))
      fail(400, "Invalid legacy PPT signature.");
    buffer = await convertLegacy(buffer);
  }
  if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50)
    fail(400, "The file is not a PPTX ZIP archive.");
  const files = await unzip(buffer);
  if (!files.has("ppt/presentation.xml"))
    fail(400, "Missing PowerPoint presentation.");
  const presentation = parse(files.get("ppt/presentation.xml"));
  const rels = relations(files, "ppt/_rels/presentation.xml.rels");
  const ids = nodes(presentation, "p:sldId");
  if (!ids.length || ids.length > 300)
    fail(400, "Upload a presentation with 1–300 slides.");
  const slides = [];
  let imageBytes = 0;
  for (const [i, node] of ids.entries()) {
    const rel = rels.get(node.attrs["@_r:id"]);
    if (!rel || rel["@_TargetMode"] === "External")
      fail(400, "Invalid slide relationship.");
    const slidePath = path.posix.normalize(
      path.posix.join("ppt", rel["@_Target"]),
    );
    if (!slidePath.startsWith("ppt/slides/") || !files.has(slidePath))
      fail(400, "Missing slide content.");
    const tree = parse(files.get(slidePath)),
      shapes = [...nodes(tree, "p:sp"), ...nodes(tree, "p:graphicFrame")],
      lines = (
        shapes.length
          ? shapes
              .map((shape, index) => ({
                shape,
                index,
                off: nodes(shape.children, "a:off")[0]?.attrs || {},
              }))
              .sort(
                (a, b) =>
                  Number(a.off["@_y"] || 0) - Number(b.off["@_y"] || 0) ||
                  Number(a.off["@_x"] || 0) - Number(b.off["@_x"] || 0) ||
                  a.index - b.index,
              )
              .flatMap(({ shape }) => nodes(shape.children, "a:p"))
          : nodes(tree, "a:p")
      ).flatMap((n) => words(n.children).split(/\r?\n/)),
      media = [],
      issues = [];
    const slideRels = relations(
      files,
      path.posix.join(
        path.posix.dirname(slidePath),
        "_rels",
        path.posix.basename(slidePath) + ".rels",
      ),
    );
    for (const pic of nodes(tree, "a:blip")) {
      const r = slideRels.get(pic.attrs["@_r:embed"]);
      if (!r || r["@_TargetMode"] === "External") {
        issues.push("External image is not imported.");
        continue;
      }
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(slidePath), r["@_Target"]),
      );
      if (!target.startsWith("ppt/media/") || !files.has(target))
        fail(400, "Missing slide image.");
      imageBytes += files.get(target).length;
      if (imageBytes > 768 * 1024)
        fail(
          400,
          "Slide images together exceed 768 KB. Compress images before uploading.",
        );
      media.push(image(files.get(target)));
    }
    if (nodes(tree, "p:graphicFrame").length || nodes(tree, "p:grpSp").length)
      issues.push(
        "Grouped objects, charts or tables need manual layout review.",
      );
    slides.push({ number: i + 1, lines, media, issues });
  }
  const result = extractQuestions(slides);
  result.slides = slides;
  return result;
}
