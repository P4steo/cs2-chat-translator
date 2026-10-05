// CS2 Chat Translator — śledzi console.log i tłumaczy wiadomości z czatu.

const POLL_MS = 500;

const $ = (id) => document.getElementById(id);
const chatOriginal = $("chatOriginal");
const chatTranslated = $("chatTranslated");
const statusEl = $("status");
const targetLangEl = $("targetLang");
const pickBtn = $("pickBtn");
const connector = $("connector");

let fileHandle = null;
let lastSize = 0;
let pollTimer = null;
let decoder = new TextDecoder("utf-8");
let lineBuffer = "";
const cache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Parsowanie ----------
// Linia czatu w console.log wygląda mniej więcej tak:
//   10/04 23:12:01  [ALL] Nick‎: wiadomość
//   [CT] Nick‎﹫Dead: wiadomość
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
    dead: !!(m[3] && /dead/i.test(m[3])),
    text: m[4].trim(),
  };
}

// ---------- Wykrywanie, czy w ogóle tłumaczyć ----------
// Growy slang zostawiamy bez zmian — tłumacze robią z niego głupoty.
const SLANG = new Set(
  ("gg wp ez gl hf glhf ns nt ty thx tx np lol lmao xd xdd rush a b mid eco " +
   "force save buy drop pls plz ok okay k afk brb ff go gogo ggwp wtf omg " +
   "nice noob bot 1 2 3 4 5 hp lit one tap").split(" ")
);

const LANG_HINTS = {
  pl: {
    chars: /[ąćęłńśźż]/i,
    words: new Set(("i w z na nie to jest się że co jak ale czy tak ja ty on my wy " +
      "mam masz ma dobra dawaj chodź gdzie idę idź tu tam już jeszcze bo dla po " +
      "kto mnie mi cię ci go jego nic kurde dzięki sorry siema elo cześć prosze proszę " +
      "kup kupcie rzuć daj weź uważaj stój czekaj teraz potem").split(" ")),
  },
  en: {
    chars: null,
    words: new Set(("the a an is are was i you he she we they it to of and in on " +
      "for with my your me what why how where who this that not no yes can cant " +
      "dont do does go come here there need please help buy drop wait team").split(" ")),
  },
  de: {
    chars: /[äöüß]/i,
    words: new Set(("der die das ist und ich du nicht ein eine mit auf wo was wie " +
      "warum bitte danke ja nein hier da kauf kaufen").split(" ")),
  },
};

function words(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

function isOnlySlang(text) {
  const w = words(text);
  return w.length > 0 && w.every((x) => SLANG.has(x));
}

function looksLike(text, lang) {
  const hints = LANG_HINTS[lang];
  if (!hints) return false;
  // inny alfabet (cyrylica, grecki, CJK…) — na pewno trzeba tłumaczyć
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(text)) return false;
  if (hints.chars && hints.chars.test(text)) return true;
  const w = words(text).filter((x) => !SLANG.has(x));
  if (!w.length) return true;
  const hits = w.filter((x) => hints.words.has(x)).length;
  return hits / w.length >= 0.34;
}

// ---------- Tłumaczenie ----------
// Darmowe API MyMemory (bez klucza, ok. 5000 znaków dziennie na IP).
// Zwraca { text, original } — original = true, gdy zostawiamy wiadomość bez zmian.
async function translate(text, target) {
  if (isOnlySlang(text) || looksLike(text, target)) return { text, original: true };

  const key = `${target}:${text}`;
  if (cache.has(key)) return cache.get(key);

  const url =
    "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) +
    "&langpair=" + encodeURIComponent(`Autodetect|${target}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText || "";

  let result;
  if (/PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(out)) {
    // API wykryło, że wiadomość już jest w języku docelowym
    result = { text, original: true };
  } else if (/MYMEMORY WARNING/i.test(out)) {
    throw new Error("limit");
  } else if (!out) {
    throw new Error("brak tłumaczenia");
  } else {
    result = { text: out, original: out.trim().toLowerCase() === text.trim().toLowerCase() };
  }
  cache.set(key, result);
  return result;
}

// ---------- Renderowanie ----------
function setEmpty(box, on) {
  const e = box.querySelector(".empty");
  if (on && !e) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = "Brak wiadomości";
    box.append(d);
  } else if (!on && e) {
    e.remove();
  }
}

function msgElement(msg) {
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
  el.append(document.createTextNode(": "));

  const body = document.createElement("span");
  body.className = "body";
  el.append(body);
  return { el, body };
}

function appendAndScroll(box, el) {
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.append(el);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function dots() {
  const s = document.createElement("span");
  s.className = "dots";
  s.innerHTML = "<i></i><i></i><i></i>";
  return s;
}

function fillResult(body, result) {
  body.replaceChildren();
  const t = document.createElement("span");
  t.className = "done";
  t.textContent = result.text;
  body.append(t);
  if (result.original) {
    const o = document.createElement("span");
    o.className = "orig";
    o.textContent = "bez tłumaczenia";
    body.append(o);
  }
}

function pulseConnector() {
  connector.classList.remove("pulse");
  void connector.offsetWidth;
  connector.classList.add("pulse");
}

async function showMessage(msg) {
  setEmpty(chatOriginal, false);
  setEmpty(chatTranslated, false);

  const left = msgElement(msg);
  left.body.textContent = msg.text;
  appendAndScroll(chatOriginal, left.el);

  const right = msgElement(msg);
  right.body.append(dots());
  appendAndScroll(chatTranslated, right.el);
  pulseConnector();

  try {
    fillResult(right.body, await translate(msg.text, targetLangEl.value));
  } catch (err) {
    right.body.replaceChildren();
    const e = document.createElement("span");
    e.className = "err";
    e.textContent = err.message === "limit"
      ? "[dzienny limit tłumaczeń wyczerpany] " + msg.text
      : "[błąd tłumaczenia] " + msg.text;
    right.body.append(e);
  }
}

// ---------- Animowany przykład na wejściu ----------
const INTRO = [
  { line: "[ALL] Dmitry: привет всем, удачи", tr: "cześć wszystkim, powodzenia" },
  { line: "[CT] Lukas: wo ist die Bombe?", tr: "gdzie jest bomba?" },
  { line: "[T] Mateo: necesito un arma, por favor", tr: "potrzebuję broni, proszę" },
  { line: "[ALL] Alexei﹫Dead: почему никто не покупает броню", tr: "czemu nikt nie kupuje kamizelki" },
  { line: "[T] Kuba: dobra, rush B", tr: null },
  { line: "[ALL] Olek: gg wp", tr: null },
];

let introId = 0;

async function playIntro() {
  const id = ++introId;
  const alive = () => id === introId;
  await sleep(900);

  for (const item of INTRO) {
    if (!alive()) return;
    const msg = parseLine(item.line);
    setEmpty(chatOriginal, false);
    setEmpty(chatTranslated, false);

    // pisanie wiadomości literka po literce
    const left = msgElement(msg);
    const caret = document.createElement("span");
    caret.className = "typing-caret";
    left.body.append(caret);
    appendAndScroll(chatOriginal, left.el);

    for (const ch of msg.text) {
      if (!alive()) return;
      caret.before(ch);
      await sleep(28 + Math.random() * 30);
    }
    caret.remove();

    await sleep(250);
    if (!alive()) return;
    const right = msgElement(msg);
    right.body.append(dots());
    appendAndScroll(chatTranslated, right.el);
    pulseConnector();

    await sleep(700);
    if (!alive()) return;
    fillResult(right.body, item.tr ? { text: item.tr, original: false } : { text: msg.text, original: true });

    await sleep(900);
  }
}

function stopIntro() {
  introId++;
}

// ---------- Śledzenie pliku ----------
async function pickFile() {
  if (!("showOpenFilePicker" in window)) {
    setStatus("Ta przeglądarka nie obsługuje odczytu plików. Użyj Chrome lub Edge.", "err");
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

  stopIntro();
  clearChat();
  setLive(true);
  pickBtn.lastChild.textContent = " Zmień plik";
  setStatus(`Śledzę: ${file.name}. Czekam na nowe wiadomości z czatu…`, "ok");

  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}

async function poll() {
  if (!fileHandle) return;
  let file;
  try {
    file = await fileHandle.getFile();
  } catch {
    setStatus("Utracono dostęp do pliku. Zaimportuj go ponownie.", "err");
    setLive(false);
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

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function setLive(on) {
  pickBtn.classList.toggle("connected", on);
  for (const b of [$("badgeLeft"), $("badgeRight")]) {
    b.classList.remove("hidden");
    b.classList.toggle("live", on);
    b.textContent = on ? "Na żywo" : "Przykład";
  }
}

// ---------- Czyszczenie ----------
function clearChat() {
  stopIntro();
  for (const box of [chatOriginal, chatTranslated]) {
    box.replaceChildren();
    setEmpty(box, true);
  }
  if (!fileHandle) {
    for (const b of [$("badgeLeft"), $("badgeRight")]) b.classList.add("hidden");
  }
}

// ---------- Panel pomocy ----------
const drawer = $("helpDrawer");
const scrim = $("scrim");
const helpBtn = $("helpBtn");

function openHelp() {
  scrim.hidden = false;
  requestAnimationFrame(() => {
    scrim.classList.add("open");
    drawer.classList.add("open");
  });
  drawer.setAttribute("aria-hidden", "false");
  helpBtn.setAttribute("aria-expanded", "true");
  $("helpClose").focus();
}

function closeHelp() {
  scrim.classList.remove("open");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  helpBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => { scrim.hidden = true; }, 250);
}

helpBtn.addEventListener("click", () => (drawer.classList.contains("open") ? closeHelp() : openHelp()));
$("helpClose").addEventListener("click", closeHelp);
scrim.addEventListener("click", closeHelp);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });
document.querySelectorAll("[data-open-help]").forEach((b) => b.addEventListener("click", openHelp));

document.querySelectorAll(".copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "Skopiowano";
      btn.classList.add("ok");
      setTimeout(() => { btn.textContent = "Kopiuj"; btn.classList.remove("ok"); }, 1500);
    } catch {
      btn.textContent = "Zaznacz ręcznie";
    }
  });
});

// ---------- Start ----------
pickBtn.addEventListener("click", pickFile);
$("clearBtn").addEventListener("click", clearChat);
playIntro();
