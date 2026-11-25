/* ===== DocScribe Backend (server.js) =====
   - Serves the web page (index.html, style.css, script.js)
   - Provides one API route: POST /api/summarize
   - Keeps the Gemini API key secret on the server (read from the .env file)
   Needs Node.js 18 or higher. No extra packages to install.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------- Load settings from the .env file ----------
function loadEnv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/);
    lines.forEach((line) => {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    });
  } catch (e) {
    /* no .env file: we will use real environment variables instead */
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Only these files can be opened by the browser (so .env stays private)
const PUBLIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"],
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Read the request body (limit about 5 MB)
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Build the prompt and ask Gemini
async function summarize(text, length, style) {
  const lengthGuide = {
    short: "2 to 3 sentences",
    medium: "one clear paragraph of about 5 to 7 sentences",
    long: "several short paragraphs that cover all the main points",
  }[length] || "one clear paragraph of about 5 to 7 sentences";

  const styleGuide =
    style === "bullets"
      ? "Write the summary as bullet points. Start each bullet with '- '."
      : "Write the summary in plain paragraph form.";

  const prompt =
    "You are a helpful assistant that summarizes documents for students.\n" +
    `Summarize the document below in ${lengthGuide}. ${styleGuide}\n` +
    "Use simple and clear English, and include only information found in the document. " +
    "Do not add a title or any introduction.\n\n" +
    "DOCUMENT:\n" + text.slice(0, 200000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data.error && data.error.message) || "Gemini error " + response.status);
  }
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts
    : null;
  if (!parts) throw new Error("Gemini returned an empty answer");
  return parts.map((p) => p.text || "").join("").trim();
}

// ---------- The server ----------
const server = http.createServer(async (req, res) => {
  // API route
  if (req.method === "POST" && req.url === "/api/summarize") {
    if (!API_KEY) {
      return sendJson(res, 500, { error: "The server has no Gemini API key. Add it to the .env file." });
    }
    try {
      const body = JSON.parse(await readBody(req));
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return sendJson(res, 400, { error: "No text was received." });

      const summary = await summarize(text, body.length, body.style);
      return sendJson(res, 200, { summary });
    } catch (err) {
      console.error("Summarize error:", err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  // Web page files
  if (req.method === "GET" && PUBLIC_FILES[req.url.split("?")[0]]) {
    const [file, type] = PUBLIC_FILES[req.url.split("?")[0]];
    return fs.readFile(path.join(__dirname, file), (err, content) => {
      if (err) {
        res.writeHead(500);
        return res.end("File error");
      }
      res.writeHead(200, { "Content-Type": type });
      res.end(content);
    });
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`DocScribe is running at http://localhost:${PORT}`);
  if (!API_KEY) console.log("WARNING: GEMINI_API_KEY is missing. Create a .env file (see .env.example).");
});
