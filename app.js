// CS2 Chat Translator — śledzi console.log i tłumaczy wiadomości z czatu.

const POLL_MS = 500;

const $ = (id) => document.getElementById(id);
const chatOriginal = $("chatOriginal");
const chatTranslated = $("chatTranslated");
const statusEl = $("status");
const targetLangEl = $("targetLang");

let fileHandle = null;
let lastSize = 0;
let pollTimer = null;
let decoder = new TextDecoder("utf-8");
let lineBuffer = "";
const cache = new Map();

// ---------- Parsowanie ----------
// Linia czatu w console.log wygląda mniej więcej tak:
//   10/04 23:12:01  [ALL] Nick‎: wiadomość
//   [CT] Nick‎﹫Dead: wiadomość
// Format może się różnić między wersjami gry — w razie potrzeby popraw regex.
const CHAT_RE =
  /\[(ALL|CT|T|TERRORIST|COUNTER-TERRORIST|SPEC)\]\s*(.+?)[‎‏]*(?:\s*[@﹫]\s*(\w+))?\s*:\s(.*)$/i;

function parseLine(line) {
  const m = line.match(CHAT_RE);
  if (!m) return null;
  const team = m[1].toUpperCase();
  return {
    team: team.startsWith("C") ? "ct" : team.startsWith("T") ? "t" : "all",
    tag: team,
    name: m[2].trim(),
    dead: m[3] && /dead/i.test(m[3]),
    text: m[4].trim(),
  };
}

// ---------- Renderowanie ----------
function clearEmpty(box) {
  const e = box.querySelector(".empty");
  if (e) e.remove();
}

function msgElement(msg, textNode) {
  const el = document.createElement("div");
  el.className = `msg ${msg.team}`;

  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = `[${msg.tag}]`;

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = msg.name;

  el.append(tag, name);
  if (msg.dead) {
    const d = document.createElement("span");
    d.className = "dead";
    d.textContent = "(nie żyje)";
    el.append(d);
  }
  el.append(document.createTextNode(": "), textNode);
  return el;
}

function appendAndScroll(box, el) {
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.append(el);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

async function showMessage(msg) {
  clearEmpty(chatOriginal);
  clearEmpty(chatTranslated);

  appendAndScroll(chatOriginal, msgElement(msg, document.createTextNode(msg.text)));

  const out = document.createElement("span");
  out.className = "pending";
  out.textContent = "tłumaczę…";
  appendAndScroll(chatTranslated, msgElement(msg, out));

  try {
    const translated = await translate(msg.text, targetLangEl.value);
    out.className = "";
    out.textContent = translated;
  } catch (err) {
    out.className = "err";
    out.textContent = `[błąd tłumaczenia] ${msg.text}`;
  }
}

// ---------- Tłumaczenie ----------
// Darmowe API MyMemory (bez klucza, ok. 5000 znaków dziennie na IP).
// Do podmiany później na DeepL / LLM przez własny backend.
async function translate(text, target) {
  const key = `${target}:${text}`;
  if (cache.has(key)) return cache.get(key);

  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) +
    "&langpair=" + encodeURIComponent(`Autodetect|${target}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  let out = data?.responseData?.translatedText;
  if (!out) throw new Error("brak tłumaczenia");

  // Jeśli wiadomość już jest w języku docelowym, API zwraca ją bez zmian.
  cache.set(key, out);
  return out;
}

// ---------- Śledzenie pliku ----------
async function pickFile() {
  if (!("showOpenFilePicker" in window)) {
    setStatus("Ta przeglądarka nie obsługuje odczytu plików. Użyj Chrome lub Edge.");
    return;
  }
  try {
    [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: "Log konsoli", accept: { "text/plain": [".log", ".txt"] } }],
    });
  } catch {
    return; // anulowano
  }

  const file = await fileHandle.getFile();
  lastSize = file.size; // pomijamy starą historię, czytamy tylko nowe wiadomości
  decoder = new TextDecoder("utf-8");
  lineBuffer = "";
  stopDemo();
  setStatus(`Śledzę: ${file.name}. Czekam na nowe wiadomości…`, true);

  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}

async function poll() {
  if (!fileHandle) return;
  let file;
  try {
    file = await fileHandle.getFile();
  } catch {
    setStatus("Utracono dostęp do pliku. Wybierz go ponownie.");
    clearInterval(pollTimer);
    return;
  }

  if (file.size < lastSize) {
    // gra uruchomiona ponownie — plik został wyczyszczony
    lastSize = 0;
    lineBuffer = "";
  }
  if (file.size === lastSize) return;

  const buf = await file.slice(lastSize, file.size).arrayBuffer();
  lastSize = file.size;

  lineBuffer += decoder.decode(buf, { stream: true });
  const lines = lineBuffer.split(/\r?\n/);
  lineBuffer = lines.pop(); // ostatnia linia może być niekompletna

  for (const line of lines) {
    const msg = parseLine(line);
    if (msg && msg.text) showMessage(msg);
  }
}

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", ok);
}

// ---------- Tryb demo ----------
const DEMO_LINES = [
  "[ALL] Dmitry‎: привет всем, удачи",
  "[T] Kuba‎: rush B no stop",
  "[CT] Lukas‎: wo ist der Bombenleger?",
  "[ALL] Alexei‎﹫Dead: почему никто не покупает броню",
  "[T] Mateo‎: necesito un arma por favor",
  "[ALL] Olek‎: gg wp",
];
let demoTimer = null;
let demoIndex = 0;

function startDemo() {
  clearInterval(pollTimer);
  fileHandle = null;
  stopDemo();
  setStatus("Tryb demo — przykładowe wiadomości co 2 sekundy.", true);
  const tick = () => {
    const msg = parseLine(DEMO_LINES[demoIndex % DEMO_LINES.length]);
    demoIndex++;
    if (msg) showMessage(msg);
  };
  tick();
  demoTimer = setInterval(tick, 2000);
}

function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
}

// ---------- Start ----------
for (const box of [chatOriginal, chatTranslated]) {
  const e = document.createElement("div");
  e.className = "empty";
  e.textContent = "Brak wiadomości";
  box.append(e);
}

$("pickBtn").addEventListener("click", pickFile);
$("demoBtn").addEventListener("click", () => (demoTimer ? (stopDemo(), setStatus("Demo zatrzymane.")) : startDemo()));
