#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP_ID = process.env.ASC_APP_ID || process.env.APP_STORE_CONNECT_APP_ID || "6781967244";
const PRIVATE_KEY_PATH =
  process.env.ASC_PRIVATE_KEY_PATH ||
  process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH ||
  "";
const KEY_ID =
  process.env.ASC_KEY_ID ||
  process.env.APP_STORE_CONNECT_KEY_ID ||
  (path.basename(PRIVATE_KEY_PATH).match(/^AuthKey_(.+)\.p8$/)?.[1] || "");
const ISSUER_ID =
  process.env.ASC_ISSUER_ID ||
  process.env.APP_STORE_CONNECT_ISSUER_ID ||
  process.env.ISSUER_ID ||
  "";
const OUT_DIR = path.resolve(
  ROOT,
  process.env.APPSTORE_FEEDBACK_OUT_DIR || "qa/appstore-api-feedback",
);

const RAW_DIR = path.join(OUT_DIR, "raw");
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const REPORT_DIR = path.join(OUT_DIR, "report");

function requireConfig() {
  const missing = [];
  if (!APP_ID) missing.push("ASC_APP_ID");
  if (!KEY_ID) missing.push("ASC_KEY_ID");
  if (!ISSUER_ID) missing.push("ASC_ISSUER_ID");
  if (!PRIVATE_KEY_PATH) missing.push("ASC_PRIVATE_KEY_PATH");
  if (PRIVATE_KEY_PATH && !fs.existsSync(PRIVATE_KEY_PATH)) {
    throw new Error(`Private key file not found: ${PRIVATE_KEY_PATH}`);
  }
  if (missing.length) {
    throw new Error(
      [
        `Missing required App Store Connect setting(s): ${missing.join(", ")}`,
        "",
        "Run with:",
        "ASC_ISSUER_ID=<issuer-uuid> \\",
        `ASC_KEY_ID=${KEY_ID || "<key-id>"} \\`,
        'ASC_PRIVATE_KEY_PATH="/secure/path/AuthKey_<key-id>.p8" \\',
        `ASC_APP_ID=${APP_ID} \\`,
        "node scripts/pull-appstore-beta-feedback.cjs",
      ].join("\n"),
    );
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt() {
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = crypto
    .createSign("SHA256")
    .update(signingInput)
    .end()
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

async function appleGet(url, accept = "application/json") {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${createJwt()}`,
      Accept: accept,
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(
      `Apple API error ${response.status} for ${url}\n${buffer
        .toString("utf8")
        .slice(0, 2000)}`,
    );
  }
  if (contentType.includes("application/json")) {
    return JSON.parse(buffer.toString("utf8"));
  }
  return { buffer, contentType };
}

async function appleGetWithFallback(urls) {
  let lastError;
  for (const url of urls) {
    try {
      return await appleGet(url);
    } catch (error) {
      lastError = error;
      const text = String(error.message || "");
      if (!text.includes("Apple API error 400")) break;
    }
  }
  throw lastError;
}

function buildListUrls() {
  const base = `https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}/betaFeedbackScreenshotSubmissions`;
  const rich = new URL(base);
  rich.searchParams.set("limit", "200");
  rich.searchParams.set("include", "build,tester");
  rich.searchParams.set(
    "fields[betaFeedbackScreenshotSubmissions]",
    [
      "createdDate",
      "comment",
      "email",
      "deviceModel",
      "osVersion",
      "locale",
      "timeZone",
      "architecture",
      "connectionType",
      "appUptimeInMilliseconds",
      "batteryPercentage",
      "screenWidthInPoints",
      "screenHeightInPoints",
      "appPlatform",
      "devicePlatform",
      "deviceFamily",
      "buildBundleId",
      "screenshots",
      "build",
      "tester",
    ].join(","),
  );
  rich.searchParams.set("fields[betaTesters]", "firstName,lastName,email,state");
  rich.searchParams.set("fields[builds]", "version,uploadedDate,processingState");

  const plainInclude = new URL(base);
  plainInclude.searchParams.set("limit", "200");
  plainInclude.searchParams.set("include", "build,tester");

  const plain = new URL(base);
  plain.searchParams.set("limit", "200");

  return [rich.toString(), plainInclude.toString(), plain.toString()];
}

async function fetchAllListPages() {
  const pages = [];
  let first = true;
  let url = buildListUrls();
  while (url) {
    const page = first ? await appleGetWithFallback(url) : await appleGet(url);
    pages.push(page);
    const pageNo = pages.length.toString().padStart(3, "0");
    fs.writeFileSync(
      path.join(RAW_DIR, `list-page-${pageNo}.json`),
      JSON.stringify(page, null, 2),
    );
    url = page.links?.next || null;
    first = false;
  }
  return pages;
}

async function fetchDetail(id) {
  const detailUrl = `https://api.appstoreconnect.apple.com/v1/betaFeedbackScreenshotSubmissions/${id}`;
  const detail = await appleGet(detailUrl);
  fs.writeFileSync(
    path.join(RAW_DIR, `feedback-${id}.json`),
    JSON.stringify(detail, null, 2),
  );
  return detail;
}

function indexIncluded(pages) {
  const map = new Map();
  for (const page of pages) {
    for (const item of page.included || []) {
      map.set(`${item.type}:${item.id}`, item);
    }
  }
  return map;
}

function walkUrls(value, urls = new Set()) {
  if (!value) return urls;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) urls.add(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const child of value) walkUrls(child, urls);
    return urls;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) walkUrls(child, urls);
  }
  return urls;
}

function looksLikeScreenshotUrl(url) {
  return (
    /screenshot|attachment|asset|feedback|download|\.png|\.jpg|\.jpeg/i.test(url) &&
    !/developer\.apple\.com\/documentation/i.test(url)
  );
}

function extFromContentType(contentType, url) {
  if (/png/i.test(contentType)) return ".png";
  if (/jpe?g/i.test(contentType)) return ".jpg";
  if (/webp/i.test(contentType)) return ".webp";
  const match = new URL(url).pathname.match(/\.(png|jpe?g|webp)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".bin";
}

async function downloadScreenshot(url, feedbackId, index) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${createJwt()}` },
  });
  let finalResponse = response;
  if (!response.ok && [401, 403].includes(response.status)) {
    finalResponse = await fetch(url);
  }
  if (!finalResponse.ok) {
    return {
      url,
      ok: false,
      status: finalResponse.status,
      error: await finalResponse.text().catch(() => ""),
    };
  }
  const contentType = finalResponse.headers.get("content-type") || "";
  const buffer = Buffer.from(await finalResponse.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const ext = extFromContentType(contentType, url);
  const fileName = `${feedbackId}-${String(index + 1).padStart(2, "0")}-${hash.slice(
    0,
    12,
  )}${ext}`;
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return { url, ok: true, contentType, hash, bytes: buffer.length, filePath };
}

function rel(filePath) {
  return path.relative(ROOT, filePath);
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function relationshipIncluded(item, included, name) {
  const data = item.relationships?.[name]?.data;
  if (!data) return null;
  if (Array.isArray(data)) {
    return data.map((entry) => included.get(`${entry.type}:${entry.id}`)).filter(Boolean);
  }
  return included.get(`${data.type}:${data.id}`) || null;
}

function normalize(item, detail, included, screenshots) {
  const attrs = { ...(item.attributes || {}), ...(detail?.data?.attributes || {}) };
  const tester = relationshipIncluded(item, included, "tester");
  const build = relationshipIncluded(item, included, "build");
  return {
    feedbackId: item.id,
    createdDate: first(attrs.createdDate, attrs.timestamp, attrs.date),
    comment: first(attrs.comment, attrs.feedback, attrs.notes),
    testerEmail: first(attrs.email, attrs.emailAddress, tester?.attributes?.email),
    testerName: [tester?.attributes?.firstName, tester?.attributes?.lastName]
      .filter(Boolean)
      .join(" "),
    deviceModel: first(attrs.deviceModel, attrs.device),
    osVersion: attrs.osVersion,
    locale: attrs.locale,
    timeZone: first(attrs.timeZone, attrs.timezone),
    architecture: attrs.architecture,
    connectionType: first(attrs.connectionType, attrs.connectionStatus),
    appPlatform: attrs.appPlatform,
    devicePlatform: attrs.devicePlatform,
    deviceFamily: attrs.deviceFamily,
    buildBundleId: attrs.buildBundleId,
    buildVersion: build?.attributes?.version,
    batteryPercentage: attrs.batteryPercentage,
    screenWidthInPoints: first(attrs.screenWidthInPoints, attrs.screenWidth),
    screenHeightInPoints: first(attrs.screenHeightInPoints, attrs.screenHeight),
    appUptimeInMilliseconds: attrs.appUptimeInMilliseconds,
    screenshots,
  };
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function writeReports(normalized) {
  const uniqueScreenshotHashes = new Set();
  let screenshotCount = 0;
  for (const item of normalized) {
    for (const shot of item.screenshots || []) {
      if (shot.ok) {
        screenshotCount += 1;
        uniqueScreenshotHashes.add(shot.hash);
      }
    }
  }

  fs.writeFileSync(
    path.join(REPORT_DIR, "appstore-feedback-report.json"),
    JSON.stringify(normalized, null, 2),
  );

  const fields = [
    "feedbackId",
    "createdDate",
    "testerEmail",
    "deviceModel",
    "osVersion",
    "locale",
    "timeZone",
    "batteryPercentage",
    "screenWidthInPoints",
    "screenHeightInPoints",
    "comment",
  ];
  const csv = [
    fields.join(","),
    ...normalized.map((item) => fields.map((field) => csvEscape(item[field])).join(",")),
  ].join("\n");
  fs.writeFileSync(path.join(REPORT_DIR, "appstore-feedback-report.csv"), `${csv}\n`);

  const lines = [];
  lines.push("# App Store Connect TestFlight Feedback Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`App Store Connect App ID: ${APP_ID}`);
  lines.push(`Feedback items: ${normalized.length}`);
  lines.push(`Downloaded screenshots: ${screenshotCount}`);
  lines.push(`Unique screenshot images: ${uniqueScreenshotHashes.size}`);
  lines.push("");
  lines.push("## Feedback");
  lines.push("");
  if (!normalized.length) {
    lines.push("No TestFlight screenshot feedback submissions were returned by Apple.");
  }
  for (const item of normalized) {
    lines.push(`### ${item.feedbackId}`);
    lines.push("");
    lines.push(`- Created: ${item.createdDate || "Unknown"}`);
    lines.push(`- Tester: ${item.testerEmail || item.testerName || "Unknown"}`);
    lines.push(
      `- Device: ${[item.deviceModel, item.osVersion].filter(Boolean).join(" / ") || "Unknown"}`,
    );
    lines.push(
      `- Screen: ${
        item.screenWidthInPoints && item.screenHeightInPoints
          ? `${item.screenWidthInPoints} x ${item.screenHeightInPoints}`
          : "Unknown"
      }`,
    );
    lines.push(`- Battery: ${item.batteryPercentage ?? "Unknown"}`);
    lines.push(`- Build: ${item.buildVersion || item.buildBundleId || "Unknown"}`);
    lines.push("");
    lines.push("Comment:");
    lines.push("");
    lines.push("```text");
    lines.push(item.comment || "");
    lines.push("```");
    lines.push("");
    if (item.screenshots?.length) {
      lines.push("Screenshots:");
      for (const shot of item.screenshots) {
        if (shot.ok) {
          lines.push(`- ${rel(shot.filePath)} (${shot.bytes} bytes, ${shot.contentType})`);
        } else {
          lines.push(`- Download failed: ${shot.status} ${shot.url}`);
        }
      }
      lines.push("");
    } else {
      lines.push("Screenshots: none exposed in this API payload.");
      lines.push("");
    }
  }
  fs.writeFileSync(path.join(REPORT_DIR, "appstore-feedback-report.md"), lines.join("\n"));
}

async function main() {
  requireConfig();
  mkdirp(RAW_DIR);
  mkdirp(SCREENSHOT_DIR);
  mkdirp(REPORT_DIR);

  const pages = await fetchAllListPages();
  const included = indexIncluded(pages);
  const uniqueItems = new Map();
  for (const page of pages) {
    for (const item of page.data || []) {
      uniqueItems.set(item.id, item);
    }
  }

  const normalized = [];
  for (const [id, item] of uniqueItems) {
    const detail = await fetchDetail(id);
    const urls = [
      ...walkUrls(item),
      ...walkUrls(detail),
      ...walkUrls(relationshipIncluded(item, included, "screenshots")),
    ].filter(looksLikeScreenshotUrl);
    const uniqueUrls = [...new Set(urls)];
    const screenshots = [];
    for (let index = 0; index < uniqueUrls.length; index += 1) {
      screenshots.push(await downloadScreenshot(uniqueUrls[index], id, index));
    }
    normalized.push(normalize(item, detail, included, screenshots));
  }

  normalized.sort((a, b) => String(b.createdDate || "").localeCompare(String(a.createdDate || "")));
  writeReports(normalized);

  console.log(`Fetched ${normalized.length} feedback item(s).`);
  console.log(`Report: ${path.join(REPORT_DIR, "appstore-feedback-report.md")}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
