/* ===== DocScribe Script =====
   Features:
   1. Accept typed text or an uploaded PDF
   2. Text analysis (word count, frequent words, etc.)
   3. AI summary using the Google Gemini API (called through server.js)
*/

// ---------- Get elements from the page ----------
const textInput = document.getElementById("textInput");
const pdfInput = document.getElementById("pdfInput");
const dropzone = document.getElementById("dropzone");
const fileNameEl = document.getElementById("fileName");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const statsEl = document.getElementById("stats");
const chartEl = document.getElementById("wordChart");
const summaryBox = document.getElementById("summaryBox");
const summaryNote = document.getElementById("summaryNote");
const lengthSelect = document.getElementById("summaryLength");
const styleSelect = document.getElementById("summaryStyle");

let activeTab = "pdf";   // "text" or "pdf"
let pdfText = "";         // text extracted from the uploaded PDF
let summaryPlain = "";    // summary saved for the copy button

// PDF.js needs a worker file
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// Common English words that are ignored in the frequent-words list
const STOP_WORDS = new Set((
  "a about above after again against all am an and any are as at be because been before being below " +
  "between both but by can could did do does doing down during each few for from further had has have " +
  "having he her here hers herself him himself his how i if in into is it its itself just me more most " +
  "my myself no nor not now of off on once only or other our ours ourselves out over own same she should " +
  "so some such than that the their theirs them themselves then there these they this those through to " +
  "too under until up very was we were what when where which while who whom why will with would you your " +
  "yours yourself yourselves also may might must shall us one two s t " +
  "ve re ll d m wasn didn doesn don haven hasn hadn couldn wouldn shouldn isn aren"
).split(" "));

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("panel-text").classList.toggle("hidden", activeTab !== "text");
    document.getElementById("panel-pdf").classList.toggle("hidden", activeTab !== "pdf");
    setStatus("");
  });
});

// ---------- PDF upload ----------
pdfInput.addEventListener("change", () => {
  if (pdfInput.files.length) {
    const file = pdfInput.files[0];
    pdfInput.value = "";
    handlePdf(file);
  }
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handlePdf(file);
});

async function handlePdf(file) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Please choose a PDF file.", "error");
    return;
  }
  if (!window.pdfjsLib) {
    setStatus("The PDF reader could not load. Please check your internet connection.", "error");
    return;
  }

  fileNameEl.textContent = file.name;
  setStatus("Reading PDF...");
  try {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n\n";
    }
    pdfText = text.trim();
    if (!pdfText) {
      setStatus("No readable text was found. The PDF may be a scanned image.", "error");
    } else {
      setStatus(`PDF loaded: ${pdf.numPages} page(s) read.`, "ok");
    }
  } catch (err) {
    console.error(err);
    pdfText = "";
    setStatus("Sorry, this PDF could not be read.", "error");
  }
}

// ---------- Main button ----------
analyzeBtn.addEventListener("click", async () => {
  const text = (activeTab === "text" ? textInput.value : pdfText).trim();

  if (!text) {
    setStatus(
      activeTab === "text" ? "Please type or paste some text first." : "Please upload a PDF with readable text first.",
      "error"
    );
    return;
  }

  // Step 1: text analysis (works without the internet)
  const analysis = analyzeText(text);
  showStats(analysis);
  showChart(analysis.topWords);
  resultsEl.classList.remove("hidden");

  // Step 2: AI summary
  analyzeBtn.disabled = true;
  summaryBox.textContent = "Generating summary...";
  summaryNote.textContent = "";
  setStatus("Asking Gemini to summarize your document...");

  try {
    const summary = await summarizeWithGemini(text);
    showSummary(summary);
    summaryNote.textContent = "Summary generated by Google Gemini.";
    setStatus("Done!", "ok");
  } catch (err) {
    // If Gemini fails, we still give a simple backup summary
    console.error(err);
    const backup = simpleSummary(text);
    showSummary(backup);
    summaryNote.textContent =
      "";
    setStatus("", "error");
  } finally {
    analyzeBtn.disabled = false;
    resultsEl.scrollIntoView({ behavior: "smooth" });
  }
});

clearBtn.addEventListener("click", () => {
  textInput.value = "";
  pdfInput.value = "";
  pdfText = "";
  fileNameEl.textContent = "";
  resultsEl.classList.add("hidden");
  summaryPlain = "";
  setStatus("");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(summaryPlain);
    copyBtn.textContent = "Copied!";
  } catch (e) {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy summary"), 1500);
});

// ---------- Text analysis ----------
function analyzeText(text) {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) || [];
  const cleanWords = words.map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);

  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  // Count how often each word appears (ignoring stop words)
  const freq = {};
  cleanWords.forEach((w) => {
    if (!STOP_WORDS.has(w) && w.length > 1 && !/^\d+$/.test(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });
  const topWords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const totalLetters = cleanWords.join("").length;
  const longest = cleanWords.reduce((a, b) => (b.length > a.length ? b : a), "");

  return {
    wordCount: cleanWords.length,
    charWithSpaces: text.length,
    charNoSpaces: text.replace(/\s/g, "").length,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    uniqueWords: new Set(cleanWords).size,
    avgWordLength: cleanWords.length ? (totalLetters / cleanWords.length).toFixed(1) : 0,
    avgSentenceLength: sentences.length ? (cleanWords.length / sentences.length).toFixed(1) : 0,
    readingTime: Math.max(1, Math.ceil(cleanWords.length / 200)), // about 200 words per minute
    longestWord: longest,
    topWords,
  };
}

function showStats(a) {
  const items = [
    [a.wordCount.toLocaleString(), "Words"],
    [a.charWithSpaces.toLocaleString(), "Characters (with spaces)"],
    [a.charNoSpaces.toLocaleString(), "Characters (no spaces)"],
    [a.sentenceCount.toLocaleString(), "Sentences"],
    [a.paragraphCount.toLocaleString(), "Paragraphs"],
    [a.uniqueWords.toLocaleString(), "Unique words"],
    [a.avgWordLength, "Avg. word length"],
    [a.avgSentenceLength, "Avg. words per sentence"],
    [a.readingTime + " min", "Reading time"],
    [a.longestWord || "-", "Longest word"],
  ];
  statsEl.innerHTML = "";
  items.forEach(([num, label]) => {
    const box = document.createElement("div");
    box.className = "stat";
    const n = document.createElement("span");
    n.className = "num";
    n.textContent = num;
    const l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    box.append(n, l);
    statsEl.appendChild(box);
  });
}

function showChart(topWords) {
  chartEl.innerHTML = "";
  if (!topWords.length) {
    chartEl.textContent = "Not enough words to show.";
    return;
  }
  const max = topWords[0][1];
  topWords.forEach(([word, count]) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    const w = document.createElement("span");
    w.className = "bar-word";
    w.textContent = word;

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = (count / max) * 100 + "%";
    track.appendChild(fill);

    const c = document.createElement("span");
    c.className = "bar-count";
    c.textContent = count;

    row.append(w, track, c);
    chartEl.appendChild(row);
  });
}

// ---------- Summary using Gemini (through our own backend) ----------
async function summarizeWithGemini(text) {
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text,
      length: lengthSelect.value,
      style: styleSelect.value,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Server error " + response.status);
  }
  return data.summary;
}

// ---------- Backup summary (no AI): picks the most important sentences ----------
function simpleSummary(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (sentences.length <= 3) return text.trim();

  const freq = {};
  (text.toLowerCase().match(/[a-z']+/g) || []).forEach((w) => {
    if (!STOP_WORDS.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1;
  });

  const scored = sentences.map((s, i) => {
    const ws = s.toLowerCase().match(/[a-z']+/g) || [];
    const score = ws.reduce((sum, w) => sum + (freq[w] || 0), 0) / (ws.length || 1);
    return { s: s.trim(), i, score };
  });

  const howMany = { short: 3, medium: 5, long: 8 }[lengthSelect.value];
  const picked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, howMany)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);

  return styleSelect.value === "bullets" ? picked.map((p) => "- " + p).join("\n") : picked.join(" ");
}

function showSummary(summary) {
  summaryPlain = summary;
  summaryBox.innerHTML = "";

  const lines = summary.split("\n").map((l) => l.trim()).filter(Boolean);
  const isBullet = (l) => /^[-*\u2022]\s+/.test(l);

  if (lines.length && lines.every(isBullet)) {
    const ul = document.createElement("ul");
    lines.forEach((l) => {
      const li = document.createElement("li");
      li.textContent = l.replace(/^[-*\u2022]\s+/, "").replace(/\*\*/g, "");
      ul.appendChild(li);
    });
    summaryBox.appendChild(ul);
  } else {
    summaryBox.textContent = summary.replace(/\*\*/g, "");
  }
}

// ---------- Helper ----------
function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = "status" + (type ? " " + type : "");
}
