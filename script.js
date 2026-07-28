// ---------------------------------------------------------------------------
// ForexPulse Mini App
// Data source: Frankfurter API (ECB-backed, free, no key required)
// ---------------------------------------------------------------------------

const FX_BASE = "https://api.frankfurter.dev/v1";
const CHECK_INTERVAL_MS = 30000;
const ALERTS_KEY = "forexpulse_alerts";
const BOT_USERNAME = "FxxPulse_Bot"; // <-- set this to your actual bot's @username (no @)

const CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY",
  "SEK", "NOK", "MXN", "SGD", "HKD", "ZAR", "TRY", "INR", "BRL",
  "PLN", "DKK", "THB", "IDR", "KRW"
];

const MAJOR_PAIRS = [
  ["EUR", "USD"], ["GBP", "USD"], ["USD", "JPY"], ["USD", "CHF"],
  ["AUD", "USD"], ["USD", "CAD"], ["NZD", "USD"], ["EUR", "GBP"],
];

let lastAlertPayload = null;

// ---------------------------------------------------------------------------
// Telegram WebApp integration (safe no-op if opened outside Telegram)
// ---------------------------------------------------------------------------
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) {
    try { tg.setHeaderColor("secondary_bg_color"); } catch (e) {}
  }
}

function haptic(type = "light") {
  try {
    if (tg?.HapticFeedback) {
      if (type === "success") tg.HapticFeedback.notificationOccurred("success");
      else tg.HapticFeedback.impactOccurred(type);
    }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Populate currency selects
// ---------------------------------------------------------------------------
function populateSelect(selectEl, defaultValue) {
  CURRENCIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (c === defaultValue) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

populateSelect(document.getElementById("baseCurrency"), "EUR");
populateSelect(document.getElementById("quoteCurrency"), "USD");
populateSelect(document.getElementById("pipBase"), "EUR");
populateSelect(document.getElementById("pipQuote"), "USD");
populateSelect(document.getElementById("alertBase"), "GBP");
populateSelect(document.getElementById("alertQuote"), "USD");

// ---------------------------------------------------------------------------
// FX API helpers
// ---------------------------------------------------------------------------
async function fetchRate(base, quote) {
  const res = await fetch(`${FX_BASE}/latest?base=${base}&symbols=${quote}`);
  const data = await res.json();
  return data.rates?.[quote] ?? null;
}

function pipSize(base, quote) {
  return quote === "JPY" || base === "JPY" ? 0.01 : 0.0001;
}

// ---------------------------------------------------------------------------
// Alerts storage (localStorage)
// ---------------------------------------------------------------------------
function getAlerts() {
  try {
    return JSON.parse(localStorage.getItem(ALERTS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveAlerts(alerts) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
}

function addAlertLocal(base, quote, targetRate, direction) {
  const alerts = getAlerts();
  const alert = { id: Date.now(), base, quote, targetRate, direction };
  alerts.push(alert);
  saveAlerts(alerts);
  return alert;
}

function removeAlert(id) {
  const alerts = getAlerts().filter((a) => a.id !== id);
  saveAlerts(alerts);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showToast(message, duration = 3500) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), duration);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    haptic("light");
    if (btn.dataset.tab === "alerts") renderAlerts();
  });
});

// ---------------------------------------------------------------------------
// Rates tab — pair lookup
// ---------------------------------------------------------------------------
document.getElementById("swapBtn").addEventListener("click", () => {
  const baseSel = document.getElementById("baseCurrency");
  const quoteSel = document.getElementById("quoteCurrency");
  const tmp = baseSel.value;
  baseSel.value = quoteSel.value;
  quoteSel.value = tmp;
  haptic("light");
});

async function handleGetRate() {
  const base = document.getElementById("baseCurrency").value;
  const quote = document.getElementById("quoteCurrency").value;
  const resultBox = document.getElementById("rateResult");

  if (base === quote) {
    showToast("Choose two different currencies.");
    return;
  }

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = `<div class="loading">Fetching rate…</div>`;

  try {
    const rate = await fetchRate(base, quote);
    if (rate === null) {
      resultBox.innerHTML = `<div class="loading">⚠️ No data for that pair</div>`;
      return;
    }
    resultBox.innerHTML = `
      <div class="rate-big">${rate.toFixed(5)}</div>
      <div class="rate-sub">1 ${base} = ${rate.toFixed(5)} ${quote}</div>
    `;
    haptic("light");
  } catch (e) {
    resultBox.innerHTML = `<div class="loading">⚠️ Couldn't fetch rate. Try again.</div>`;
  }
}

document.getElementById("getRateBtn").addEventListener("click", handleGetRate);

// ---------------------------------------------------------------------------
// Rates tab — convert amount
// ---------------------------------------------------------------------------
async function handleConvert() {
  const amount = parseFloat(document.getElementById("convertAmount").value);
  const base = document.getElementById("baseCurrency").value;
  const quote = document.getElementById("quoteCurrency").value;
  const resultBox = document.getElementById("convertResult");

  if (isNaN(amount) || amount <= 0) {
    showToast("Enter a valid amount.");
    return;
  }

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = `<div class="loading">Converting…</div>`;

  try {
    const rate = await fetchRate(base, quote);
    if (rate === null) {
      resultBox.innerHTML = `<div class="loading">⚠️ No data for that pair</div>`;
      return;
    }
    const converted = amount * rate;
    resultBox.innerHTML = `
      <div class="rate-big">${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${quote}</div>
      <div class="rate-sub">${amount.toLocaleString()} ${base} at rate ${rate.toFixed(5)}</div>
    `;
    haptic("light");
  } catch (e) {
    resultBox.innerHTML = `<div class="loading">⚠️ Conversion failed. Try again.</div>`;
  }
}

document.getElementById("convertBtn").addEventListener("click", handleConvert);

// ---------------------------------------------------------------------------
// Rates tab — major pairs list
// ---------------------------------------------------------------------------
async function renderMajorPairs() {
  const container = document.getElementById("majorPairsList");
  container.innerHTML = `<div class="loading">Loading rates…</div>`;

  try {
    const results = await Promise.all(
      MAJOR_PAIRS.map(async ([base, quote]) => {
        const rate = await fetchRate(base, quote);
        return { base, quote, rate };
      })
    );

    container.innerHTML = "";
    results.forEach(({ base, quote, rate }) => {
      const card = document.createElement("div");
      card.className = "pair-card";
      card.innerHTML = `
        <div>
          <div class="pair-card-name">${base}/${quote}</div>
          <div class="pair-card-sub">Live ECB reference rate</div>
        </div>
        <div class="pair-card-rate">${rate !== null ? rate.toFixed(5) : "—"}</div>
      `;
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = `<div class="loading">⚠️ Couldn't load rates. Pull to refresh.</div>`;
  }
}

document.getElementById("refreshRatesBtn").addEventListener("click", () => {
  haptic("light");
  renderMajorPairs();
});

// ---------------------------------------------------------------------------
// Pip calculator tab
// ---------------------------------------------------------------------------
document.querySelectorAll(".lot-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lot-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("lotSize").value = btn.dataset.lot;
    haptic("light");
  });
});

async function handleCalcPip() {
  const base = document.getElementById("pipBase").value;
  const quote = document.getElementById("pipQuote").value;
  const lotSize = parseFloat(document.getElementById("lotSize").value);
  const resultBox = document.getElementById("pipResult");

  if (isNaN(lotSize) || lotSize <= 0) {
    showToast("Enter a valid lot size.");
    return;
  }
  if (base === quote) {
    showToast("Choose two different currencies.");
    return;
  }

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = `<div class="loading">Calculating…</div>`;

  try {
    const units = lotSize * 100000;
    const size = pipSize(base, quote);
    const pipValueQuote = units * size;

    let usdNote = "";
    if (quote !== "USD") {
      const rateToUsd = await fetchRate(quote, "USD");
      if (rateToUsd) {
        const pipValueUsd = pipValueQuote * rateToUsd;
        usdNote = `<div class="rate-sub">≈ ${pipValueUsd.toFixed(2)} USD</div>`;
      }
    }

    resultBox.innerHTML = `
      <div class="pip-big">${pipValueQuote.toFixed(2)} ${quote}</div>
      <div class="rate-sub">per pip · ${lotSize} lot (${units.toLocaleString()} units) · ${base}/${quote}</div>
      ${usdNote}
    `;
    haptic("success");
  } catch (e) {
    resultBox.innerHTML = `<div class="loading">⚠️ Calculation failed. Try again.</div>`;
  }
}

document.getElementById("calcPipBtn").addEventListener("click", handleCalcPip);

// ---------------------------------------------------------------------------
// Alerts tab
// ---------------------------------------------------------------------------
async function handleAddAlert() {
  const base = document.getElementById("alertBase").value;
  const quote = document.getElementById("alertQuote").value;
  const targetRate = parseFloat(document.getElementById("alertRate").value);
  const direction = document.getElementById("alertDirection").value;

  if (base === quote) {
    showToast("Choose two different currencies.");
    return;
  }
  if (isNaN(targetRate) || targetRate <= 0) {
    showToast("Enter a valid target rate.");
    return;
  }

  addAlertLocal(base, quote, targetRate, direction);
  document.getElementById("alertRate").value = "";
  renderAlerts();
  showToast(`✅ Alert set: ${base}/${quote} ${direction} ${targetRate}`);
  haptic("success");

  lastAlertPayload = { base, quote, targetRate, direction };
  const notifyBtn = document.getElementById("notifyViaBotBtn");
  notifyBtn.textContent = `🔔 Also notify me via bot for ${base}/${quote}`;
  notifyBtn.classList.remove("hidden");
}

document.getElementById("addAlertBtn").addEventListener("click", handleAddAlert);

document.getElementById("notifyViaBotBtn").addEventListener("click", () => {
  if (!lastAlertPayload) return;
  const { base, quote, targetRate, direction } = lastAlertPayload;
  const payload = `${base}${quote}_${targetRate}_${direction}`;
  const deepLink = `https://t.me/${BOT_USERNAME}?start=${payload}`;

  haptic("light");

  if (tg?.openTelegramLink) {
    tg.openTelegramLink(deepLink);
  } else {
    window.open(deepLink, "_blank");
  }
});

function renderAlerts() {
  const container = document.getElementById("alertsList");
  const alerts = getAlerts();

  if (!alerts.length) {
    container.innerHTML = `<p class="empty-state">No alerts yet. Set one above.</p>`;
    return;
  }

  container.innerHTML = "";
  alerts.forEach((a) => {
    const card = document.createElement("div");
    card.className = "alert-card";
    card.innerHTML = `
      <div class="alert-card-info">
        <div class="alert-card-title">${a.base}/${a.quote} ${a.direction} ${a.targetRate}</div>
        <div class="alert-card-sub">Watching live</div>
      </div>
      <button class="delete-btn" data-id="${a.id}">✕</button>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeAlert(parseInt(btn.dataset.id));
      renderAlerts();
      haptic("light");
    });
  });
}

// ---------------------------------------------------------------------------
// Background alert checker (runs while app is open)
// ---------------------------------------------------------------------------
async function checkAlerts() {
  const alerts = getAlerts();
  if (!alerts.length) return;

  const uniquePairs = [...new Set(alerts.map((a) => `${a.base}_${a.quote}`))];
  const rates = {};

  for (const pairKey of uniquePairs) {
    const [base, quote] = pairKey.split("_");
    try {
      const rate = await fetchRate(base, quote);
      if (rate !== null) rates[pairKey] = rate;
    } catch (e) {
      // skip, retry next cycle
    }
  }

  let remaining = [...alerts];
  let triggeredAny = false;

  for (const alert of alerts) {
    const key = `${alert.base}_${alert.quote}`;
    const current = rates[key];
    if (current === undefined) continue;

    const triggered =
      (alert.direction === "above" && current >= alert.targetRate) ||
      (alert.direction === "below" && current <= alert.targetRate);

    if (triggered) {
      triggeredAny = true;
      showToast(`🔔 ${alert.base}/${alert.quote} is now ${current.toFixed(5)} (${alert.direction} ${alert.targetRate})`, 6000);
      haptic("success");

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("ForexPulse Alert", {
          body: `${alert.base}/${alert.quote} is now ${current.toFixed(5)}`,
        });
      }

      remaining = remaining.filter((a) => a.id !== alert.id);
    }
  }

  if (triggeredAny) {
    saveAlerts(remaining);
    renderAlerts();
  }
}

if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
renderMajorPairs();
renderAlerts();
setInterval(checkAlerts, CHECK_INTERVAL_MS);
setInterval(renderMajorPairs, 60000);
