const $ = (id) => document.getElementById(id);

const state = {
  instruments: [],
  timeframes: {},
  contractTypes: {},
  bars: [],
  visibleBars: [],
  replayStartTs: 0,
  replayEndTs: 0,
  replayStartIndex: 0,
  timer: null,
  cursor: 0,
  position: null,
  trades: [],
  history: [],
  userAdjustedView: false,
  followLatest: false,
  lastVisibleRange: null,
  config: null,
  currentInstrument: null,
  loading: false,
};

const priceChart = LightweightCharts.createChart($("priceChart"), {
  layout: { background: { color: "#ffffff" }, textColor: "#334155" },
  grid: { vertLines: { color: "#edf1f5" }, horzLines: { color: "#edf1f5" } },
  rightPriceScale: { borderColor: "#d9e0e7" },
  timeScale: { borderColor: "#d9e0e7", timeVisible: true },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const macdChart = LightweightCharts.createChart($("macdChart"), {
  layout: { background: { color: "#ffffff" }, textColor: "#334155" },
  grid: { vertLines: { color: "#edf1f5" }, horzLines: { color: "#edf1f5" } },
  rightPriceScale: { borderColor: "#d9e0e7" },
  timeScale: { borderColor: "#d9e0e7", timeVisible: true },
});

const candleSeries = priceChart.addCandlestickSeries({
  upColor: "#0f9f6e",
  downColor: "#d44a3a",
  borderUpColor: "#0f9f6e",
  borderDownColor: "#d44a3a",
  wickUpColor: "#0f9f6e",
  wickDownColor: "#d44a3a",
});
const bollMid = priceChart.addLineSeries({ color: "#2867c8", lineWidth: 1, priceLineVisible: false });
const bollUp = priceChart.addLineSeries({ color: "#b7791f", lineWidth: 1, priceLineVisible: false });
const bollLow = priceChart.addLineSeries({ color: "#b7791f", lineWidth: 1, priceLineVisible: false });
const takeProfitLine = priceChart.addLineSeries({
  color: "#0f9f6e",
  lineWidth: 1,
  lineStyle: "dashed",
  dragKey: "take_profit",
  priceLineVisible: false,
});
const stopLossLine = priceChart.addLineSeries({
  color: "#d44a3a",
  lineWidth: 1,
  lineStyle: "dashed",
  dragKey: "stop_loss",
  priceLineVisible: false,
});
const macdHist = macdChart.addHistogramSeries({ priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
const difLine = macdChart.addLineSeries({ color: "#2867c8", lineWidth: 1, priceLineVisible: false });
const deaLine = macdChart.addLineSeries({ color: "#d44a3a", lineWidth: 1, priceLineVisible: false });

priceChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
  if (range) macdChart.timeScale().setVisibleRange(range);
});
macdChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
  if (range) priceChart.timeScale().setVisibleRange(range);
});

window.addEventListener("resize", resizeCharts);
$("priceChart").addEventListener("mousemove", showHoveredBar);
$("priceChart").addEventListener("mouseleave", updateUi);
$("priceChart").addEventListener("chart-line-drag-start", () => pushHistory());
$("priceChart").addEventListener("chart-line-drag", onRiskLineDrag);
$("priceChart").addEventListener("chart-range-change", (event) => {
  const source = event.detail?.source;
  if (event.detail?.range) state.lastVisibleRange = event.detail.range;
  if (source === "wheel") state.userAdjustedView = true;
  if (source === "pan") {
    state.userAdjustedView = true;
    if (!state.timer) state.followLatest = false;
  }
});

function resizeCharts() {
  priceChart.applyOptions({ width: $("priceChart").clientWidth, height: $("priceChart").clientHeight });
  macdChart.applyOptions({ width: $("macdChart").clientWidth, height: $("macdChart").clientHeight });
}

function setStatus(text) {
  $("statusText").textContent = text;
}

function apiGet(url) {
  return fetch(url).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "请求失败");
    return data;
  });
}

async function apiPost(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "请求失败");
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("请求超时，请检查服务后重试");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function runDataAction(fn) {
  if (state.loading) return;
  state.loading = true;
  $("downloadBtn").disabled = true;
  $("startBtn").disabled = true;
  try {
    await run(fn);
  } finally {
    state.loading = false;
    $("downloadBtn").disabled = false;
    $("startBtn").disabled = false;
  }
}

function initDates() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  $("startDate").value = toLocalInput(start);
  $("endDate").value = toLocalInput(end);
}

function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
}

function pnlClass(value) {
  return value >= 0 ? "profit" : "loss";
}

function pricePrecision() {
  const tick = state.currentInstrument?.tick_size || 1;
  const text = String(tick);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

function currentCapital() {
  const base = Number(state.config?.initial_capital ?? $("capital").value) || 0;
  return base + totalPnl();
}

function roundToTick(value) {
  const tick = state.currentInstrument?.tick_size || 1;
  return Math.round(value / tick) * tick;
}

async function boot() {
  initDates();
  resizeCharts();
  const meta = await apiGet("/api/instruments");
  state.instruments = meta.instruments;
  state.timeframes = meta.timeframes;
  state.contractTypes = meta.contract_types;
  fillSelects();
  updateRiskModeLabels();
  await refreshSessions();
  lucide.createIcons();
}

function fillSelects() {
  $("instrument").innerHTML = state.instruments
    .map((item) => `<option value="${item.id}">${item.name} ${item.id}</option>`)
    .join("");
  $("contractType").innerHTML = Object.entries(state.contractTypes)
    .map(([key, item]) => `<option value="${key}">${item.label}</option>`)
    .join("");
  $("timeframe").innerHTML = Object.entries(state.timeframes)
    .map(([key, item]) => `<option value="${key}">${item.label}</option>`)
    .join("");
}

function readConfig() {
  return {
    instrument_id: $("instrument").value,
    contract_type: $("contractType").value,
    timeframe: $("timeframe").value,
    start: $("startDate").value,
    end: $("endDate").value,
    initial_capital: Number($("capital").value),
  };
}

function withLookback(config) {
  const startTs = Math.floor(new Date(config.start).getTime() / 1000);
  const lookbackDays = {
    "5m": 5,
    "15m": 10,
    "30m": 15,
    "1h": 30,
    "1d": 240,
  }[config.timeframe] || 10;
  return {
    ...config,
    start: toLocalInput(new Date((startTs - lookbackDays * 24 * 3600) * 1000)),
  };
}

async function downloadData() {
  const config = readConfig();
  setStatus("下载中");
  const data = await apiPost("/api/download", withLookback(config));
  setStatus(`已缓存 ${data.bars.length} 根`);
}

async function startTraining() {
  const config = readConfig();
  const loadConfig = withLookback(config);
  setStatus("准备前置K线");
  await apiPost("/api/download", loadConfig);
  const query = new URLSearchParams(loadConfig).toString();
  const data = await apiGet(`/api/bars?${query}`);
  if (!data.bars.length) throw new Error("本地没有该区间数据，请先下载/更新");

  const replayStartTs = Math.floor(new Date(config.start).getTime() / 1000);
  const replayEndTs = Math.floor(new Date(config.end).getTime() / 1000);
  const startIndex = data.bars.findIndex((bar) => bar.time >= replayStartTs);
  if (startIndex < 0) throw new Error("本地缓存里没有复盘开始时间之后的数据，请先下载/更新");

  state.config = config;
  state.currentInstrument = data.instrument;
  state.bars = data.bars;
  state.replayStartTs = replayStartTs;
  state.replayEndTs = replayEndTs;
  state.replayStartIndex = startIndex;
  const contextStart = Math.max(0, startIndex - 120);
  state.visibleBars = data.bars.slice(contextStart, startIndex);
  state.cursor = startIndex;
  state.position = null;
  state.trades = [];
  state.history = [];
  state.userAdjustedView = false;
    if (!state.timer) state.followLatest = false;
  state.lastVisibleRange = null;
  pause();
  updateCharts();
  updateUi();
  setButtons(true);
  setStatus(`训练中 · 已预载${state.visibleBars.length}根`);
  $("chartTitle").textContent = `${data.instrument.name} · ${state.contractTypes[config.contract_type].label} · ${state.timeframes[config.timeframe].label} · 预载${state.visibleBars.length}根`;
  step();
  followLatestView();
}

function setButtons(active) {
  $("prevBtn").disabled = !active || state.history.length === 0;
  $("playBtn").disabled = !active;
  $("pauseBtn").disabled = !active;
  $("stepBtn").disabled = !active;
  $("longBtn").disabled = !active;
  $("shortBtn").disabled = !active;
  $("saveBtn").disabled = !active;
}

function play() {
  if (state.timer) return;
  state.followLatest = true;
  followLatestView();
  state.timer = setInterval(step, Number($("speed").value));
}

function pause() {
  clearInterval(state.timer);
  state.timer = null;
  state.followLatest = false;
}

function snapshot() {
  return {
    visibleBars: state.visibleBars.slice(),
    cursor: state.cursor,
    position: state.position ? { ...state.position } : null,
    trades: state.trades.map((trade) => ({ ...trade })),
  };
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 500) state.history.shift();
  $("prevBtn").disabled = false;
}

function previousStep() {
  pause();
  const prev = state.history.pop();
  if (!prev) return;
  const oldLatest = state.visibleBars[state.visibleBars.length - 1]?.time;
  state.visibleBars = prev.visibleBars;
  state.cursor = prev.cursor;
  state.position = prev.position;
  state.trades = prev.trades;
  updateCharts();
  shiftVisibleRangeAfterUndo(oldLatest);
  updateUi();
}

function step() {
  if (state.cursor >= state.bars.length) {
    pause();
    setStatus("已到结尾");
    return;
  }
  const bar = state.bars[state.cursor];
  if (bar.time > state.replayEndTs) {
    pause();
    setStatus("已到结尾");
    return;
  }
  pushHistory();
  state.cursor += 1;
  state.visibleBars.push(bar);
  evaluatePosition(bar);
  updateCharts();
  updateUi();
}

function updateCharts() {
  const candles = state.visibleBars.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
  candleSeries.setData(candles);
  const boll = calcBoll(state.visibleBars);
  bollMid.setData(boll.mid);
  bollUp.setData(boll.up);
  bollLow.setData(boll.low);
  updateRiskLines();
  const macd = calcMacd(state.visibleBars);
  macdHist.setData(macd.hist);
  difLine.setData(macd.dif);
  deaLine.setData(macd.dea);
  candleSeries.setMarkers(makeMarkers());
  if (state.followLatest) followLatestView();
}

function followLatestView() {
  if (!state.visibleBars.length) return;
  const latest = state.visibleBars[state.visibleBars.length - 1].time;
  const step = state.timeframes[state.config?.timeframe]?.seconds || 60;
  const currentSpan = state.lastVisibleRange
    ? Math.max(step * 8, state.lastVisibleRange.to - state.lastVisibleRange.from)
    : step * 120;
  const range = { from: latest - currentSpan, to: latest };
  state.lastVisibleRange = range;
  priceChart.timeScale().setVisibleRange(range);
  macdChart.timeScale().setVisibleRange(range);
}

function shiftVisibleRangeAfterUndo(oldLatest) {
  if (!state.lastVisibleRange || !oldLatest || !state.visibleBars.length) return;
  const latest = state.visibleBars[state.visibleBars.length - 1].time;
  const diff = oldLatest - latest;
  if (!diff) return;
  const range = {
    from: state.lastVisibleRange.from - diff,
    to: state.lastVisibleRange.to - diff,
  };
  state.lastVisibleRange = range;
  priceChart.timeScale().setVisibleRange(range);
  macdChart.timeScale().setVisibleRange(range);
}

function updateRiskLines() {
  if (!state.position || !state.visibleBars.length) {
    takeProfitLine.setData([]);
    stopLossLine.setData([]);
    return;
  }
  const from = state.position.entry_time;
  const to = state.visibleBars[state.visibleBars.length - 1].time;
  takeProfitLine.setData([
    { time: from, value: state.position.take_profit },
    { time: to, value: state.position.take_profit },
  ]);
  stopLossLine.setData([
    { time: from, value: state.position.stop_loss },
    { time: to, value: state.position.stop_loss },
  ]);
}

function calcBoll(bars, period = 20, k = 2) {
  const mid = [];
  const up = [];
  const low = [];
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, bar) => sum + bar.close, 0) / period;
    const variance = slice.reduce((sum, bar) => sum + Math.pow(bar.close - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);
    const time = bars[i].time;
    mid.push({ time, value: mean });
    up.push({ time, value: mean + k * sd });
    low.push({ time, value: mean - k * sd });
  }
  return { mid, up, low };
}

function ema(prev, value, period) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : alpha * value + (1 - alpha) * prev;
}

function calcMacd(bars) {
  let ema12 = null;
  let ema26 = null;
  let dea = null;
  const dif = [];
  const deaData = [];
  const hist = [];
  for (const bar of bars) {
    ema12 = ema(ema12, bar.close, 12);
    ema26 = ema(ema26, bar.close, 26);
    const d = ema12 - ema26;
    dea = ema(dea, d, 9);
    const h = (d - dea) * 2;
    dif.push({ time: bar.time, value: d });
    deaData.push({ time: bar.time, value: dea });
    hist.push({ time: bar.time, value: h, color: h >= 0 ? "#0f9f6e" : "#d44a3a" });
  }
  return { dif, dea: deaData, hist };
}

function riskPrices(direction, entry) {
  const tp = Number($("takeProfit").value);
  const sl = Number($("stopLoss").value);
  if ($("riskMode").value === "price") {
    return { takeProfit: tp, stopLoss: sl };
  }
  return {
    takeProfit: direction === "long" ? entry + tp : entry - tp,
    stopLoss: direction === "long" ? entry - sl : entry + sl,
  };
}

function riskQuantity(direction) {
  if (!state.currentInstrument || !state.visibleBars.length) return null;
  const entry = state.visibleBars[state.visibleBars.length - 1].close;
  const prices = riskPrices(direction, entry);
  const riskPercent = Number($("riskPercent").value) / 100;
  const stopDistance = Math.abs(entry - prices.stopLoss);
  const perLotRisk = stopDistance * state.currentInstrument.multiplier;
  if (!Number.isFinite(perLotRisk) || perLotRisk <= 0 || riskPercent <= 0) return null;
  const riskAmount = currentCapital() * riskPercent;
  return Math.max(1, Math.floor(riskAmount / perLotRisk));
}

function updateSuggestedQuantity() {
  const bar = state.visibleBars[state.visibleBars.length - 1];
  if (!bar || !state.currentInstrument) {
    $("suggestedQty").textContent = "-";
    return;
  }
  const direction = $("shortBtn").classList.contains("active-side") ? "short" : "long";
  const qty = riskQuantity(direction);
  $("suggestedQty").textContent = qty == null ? "-" : `${qty} 手`;
  if ($("autoQuantity").checked && qty != null && !state.position) {
    $("quantity").value = qty;
  }
}

function openPosition(direction) {
  if (state.position || !state.visibleBars.length) return;
  const bar = state.visibleBars[state.visibleBars.length - 1];
  if (bar.time < state.replayStartTs) return;
  const autoQty = riskQuantity(direction);
  const qty = $("autoQuantity").checked && autoQty != null ? autoQty : Number($("quantity").value);
  const entry = bar.close;
  const prices = riskPrices(direction, entry);
  if (!Number.isFinite(prices.takeProfit) || !Number.isFinite(prices.stopLoss)) {
    alert("请填写有效的止盈止损");
    return;
  }
  pushHistory();
  state.position = {
    direction,
    entry_time: bar.time,
    entry_price: entry,
    quantity: qty,
    take_profit: prices.takeProfit,
    stop_loss: prices.stopLoss,
  };
  $("quantity").value = qty;
  updateCharts();
  updateUi();
}

function evaluatePosition(bar) {
  if (!state.position) return;
  const p = state.position;
  let exitPrice = null;
  let reason = "";
  if (p.direction === "long") {
    if (bar.low <= p.stop_loss && bar.high >= p.take_profit) {
      exitPrice = p.stop_loss;
      reason = "止损优先";
    } else if (bar.low <= p.stop_loss) {
      exitPrice = p.stop_loss;
      reason = "止损";
    } else if (bar.high >= p.take_profit) {
      exitPrice = p.take_profit;
      reason = "止盈";
    }
  } else {
    if (bar.high >= p.stop_loss && bar.low <= p.take_profit) {
      exitPrice = p.stop_loss;
      reason = "止损优先";
    } else if (bar.high >= p.stop_loss) {
      exitPrice = p.stop_loss;
      reason = "止损";
    } else if (bar.low <= p.take_profit) {
      exitPrice = p.take_profit;
      reason = "止盈";
    }
  }
  if (exitPrice != null) closePosition(exitPrice, bar.time, reason, false);
}

function manualClose() {
  if (!state.position || !state.visibleBars.length) return;
  const bar = state.visibleBars[state.visibleBars.length - 1];
  pushHistory();
  closePosition(bar.close, bar.time, "手动", false);
}

function closePosition(exitPrice, exitTime, reason) {
  const p = state.position;
  const multiplier = state.currentInstrument.multiplier;
  const diff = p.direction === "long" ? exitPrice - p.entry_price : p.entry_price - exitPrice;
  const pnl = diff * multiplier * p.quantity;
  state.trades.push({
    direction: p.direction,
    entry_time: p.entry_time,
    entry_price: p.entry_price,
    exit_time: exitTime,
    exit_price: exitPrice,
    quantity: p.quantity,
    take_profit: p.take_profit,
    stop_loss: p.stop_loss,
    pnl,
    exit_reason: reason,
  });
  state.position = null;
  updateCharts();
  updateUi();
}

function makeMarkers() {
  const markers = [];
  for (const trade of state.trades) {
    markers.push({
      time: trade.entry_time,
      price: trade.entry_price,
      position: trade.direction === "long" ? "belowBar" : "aboveBar",
      color: trade.direction === "long" ? "#0f9f6e" : "#d44a3a",
      shape: trade.direction === "long" ? "arrowUp" : "arrowDown",
      text: trade.direction === "long" ? "多" : "空",
    });
    markers.push({
      time: trade.exit_time,
      price: trade.exit_price,
      position: trade.direction === "long" ? "aboveBar" : "belowBar",
      color: "#2867c8",
      shape: trade.direction === "long" ? "arrowDown" : "arrowUp",
      text: trade.exit_reason,
    });
  }
  if (state.position) {
    markers.push({
      time: state.position.entry_time,
      price: state.position.entry_price,
      position: state.position.direction === "long" ? "belowBar" : "aboveBar",
      color: state.position.direction === "long" ? "#0f9f6e" : "#d44a3a",
      shape: state.position.direction === "long" ? "arrowUp" : "arrowDown",
      text: state.position.direction === "long" ? "持多" : "持空",
    });
  }
  return markers;
}

function floatingPnl() {
  if (!state.position || !state.visibleBars.length) return 0;
  const bar = state.visibleBars[state.visibleBars.length - 1];
  const p = state.position;
  const diff = p.direction === "long" ? bar.close - p.entry_price : p.entry_price - bar.close;
  return diff * state.currentInstrument.multiplier * p.quantity;
}

function totalPnl() {
  return state.trades.reduce((sum, trade) => sum + trade.pnl, 0);
}

function updateUi() {
  const bar = state.visibleBars[state.visibleBars.length - 1];
  $("barInfo").textContent = bar ? `${formatTime(bar.time)} O:${bar.open} H:${bar.high} L:${bar.low} C:${bar.close}` : "";
  $("floatingPnl").textContent = floatingPnl().toFixed(2);
  $("floatingPnl").className = pnlClass(floatingPnl());
  $("totalPnl").textContent = totalPnl().toFixed(2);
  $("totalPnl").className = pnlClass(totalPnl());
  $("tradeCount").textContent = state.trades.length;
  updateSuggestedQuantity();
  $("prevBtn").disabled = !state.config || state.history.length === 0;
  $("closeBtn").disabled = !state.position;
  $("longBtn").disabled = !state.config || !!state.position || !state.visibleBars.length;
  $("shortBtn").disabled = !state.config || !!state.position || !state.visibleBars.length;
  if (bar && bar.time < state.replayStartTs) {
    $("longBtn").disabled = true;
    $("shortBtn").disabled = true;
  }

  if (state.position) {
    const precision = pricePrecision();
    $("posDirection").textContent = state.position.direction === "long" ? "多" : "空";
    $("posEntry").textContent = state.position.entry_price.toFixed(precision);
    $("posTp").textContent = state.position.take_profit.toFixed(precision);
    $("posSl").textContent = state.position.stop_loss.toFixed(precision);
    $("posQty").textContent = state.position.quantity;
    if ($("riskMode").value === "price") {
      $("takeProfit").value = state.position.take_profit.toFixed(precision);
      $("stopLoss").value = state.position.stop_loss.toFixed(precision);
    }
  } else {
    $("posDirection").textContent = "无";
    $("posEntry").textContent = "-";
    $("posTp").textContent = "-";
    $("posSl").textContent = "-";
    $("posQty").textContent = "-";
  }
  renderTrades();
}

function showHoveredBar(event) {
  if (!state.visibleBars.length) return;
  const rect = $("priceChart").getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const index = Math.round((x / Math.max(1, rect.width)) * (state.visibleBars.length - 1));
  const bar = state.visibleBars[index];
  if (!bar) return;
  $("barInfo").textContent = `${formatTime(bar.time)} O:${bar.open} H:${bar.high} L:${bar.low} C:${bar.close}`;
}

function onRiskLineDrag(event) {
  if (!state.position) return;
  const key = event.detail?.key;
  const price = roundToTick(Number(event.detail?.price));
  if (!key || !Number.isFinite(price)) return;
  state.position[key] = price;
  updateCharts();
  updateUi();
}

function updateRiskModeLabels() {
  const priceMode = $("riskMode").value === "price";
  $("takeProfitLabel").textContent = priceMode ? "止盈目标价" : "止盈点数";
  $("stopLossLabel").textContent = priceMode ? "止损目标价" : "止损点数";
}

function renderTrades() {
  $("tradeRows").innerHTML = state.trades.map((trade, index) => `
    <tr data-index="${index}">
      <td>${trade.direction === "long" ? "多" : "空"}</td>
      <td>${formatTime(trade.entry_time)}</td>
      <td>${trade.entry_price.toFixed(pricePrecision())}</td>
      <td>${formatTime(trade.exit_time)}</td>
      <td>${trade.exit_price.toFixed(pricePrecision())}</td>
      <td>${trade.quantity}</td>
      <td class="${pnlClass(trade.pnl)}">${trade.pnl.toFixed(2)}</td>
      <td>${trade.exit_reason}</td>
    </tr>
  `).join("");
  [...$("tradeRows").querySelectorAll("tr")].forEach((row) => {
    row.addEventListener("click", () => focusTrade(state.trades[Number(row.dataset.index)]));
  });
}

function focusTrade(trade) {
  const from = trade.entry_time - 20 * state.timeframes[state.config.timeframe].seconds;
  const to = trade.exit_time + 20 * state.timeframes[state.config.timeframe].seconds;
  priceChart.timeScale().setVisibleRange({ from, to });
}

async function saveSession() {
  if (!state.config) return;
  pause();
  const payload = {
    ...state.config,
    start_time: Math.floor(new Date(state.config.start).getTime() / 1000),
    end_time: Math.floor(new Date(state.config.end).getTime() / 1000),
    trades: state.trades,
  };
  const result = await apiPost("/api/sessions", payload);
  setStatus(`已保存 #${result.id}`);
  await refreshSessions();
}

async function refreshSessions() {
  const data = await apiGet("/api/sessions");
  $("sessionList").innerHTML = data.sessions.map((s) => {
    const instrument = state.instruments.find((item) => item.id === s.instrument_id);
    const name = instrument ? instrument.name : s.instrument_id;
    return `<button class="session-item" data-id="${s.id}">
      <span>#${s.id} ${name} ${s.timeframe} <b class="${pnlClass(s.total_pnl)}">${Number(s.total_pnl).toFixed(2)}</b></span>
      <small>${formatTime(s.start_time)} - ${formatTime(s.end_time)} · ${s.trade_count} 笔</small>
    </button>`;
  }).join("");
  [...$("sessionList").querySelectorAll("button")].forEach((btn) => {
    btn.addEventListener("click", () => runDataAction(() => loadSession(Number(btn.dataset.id))));
  });
}

async function loadSession(id) {
  const session = await apiGet(`/api/sessions/${id}`);
  $("instrument").value = session.instrument_id;
  $("contractType").value = session.contract_type;
  $("timeframe").value = session.timeframe;
  $("startDate").value = toLocalInput(new Date(session.start_time * 1000));
  $("endDate").value = toLocalInput(new Date(session.end_time * 1000));
  $("capital").value = session.initial_capital;
  await startTraining();
  state.visibleBars = state.bars.slice();
  state.cursor = state.bars.length;
  state.trades = session.trades;
  state.history = [];
  pause();
  updateCharts();
  updateUi();
  setStatus(`已加载 #${id}`);
}

function wireEvents() {
  $("downloadBtn").addEventListener("click", () => runDataAction(downloadData));
  $("startBtn").addEventListener("click", () => runDataAction(startTraining));
  $("prevBtn").addEventListener("click", previousStep);
  $("playBtn").addEventListener("click", play);
  $("pauseBtn").addEventListener("click", pause);
  $("stepBtn").addEventListener("click", step);
  $("longBtn").addEventListener("click", () => openPosition("long"));
  $("shortBtn").addEventListener("click", () => openPosition("short"));
  $("closeBtn").addEventListener("click", manualClose);
  $("saveBtn").addEventListener("click", () => run(saveSession));
  $("riskMode").addEventListener("change", updateRiskModeLabels);
  $("riskPercent").addEventListener("input", updateSuggestedQuantity);
  $("autoQuantity").addEventListener("change", updateSuggestedQuantity);
  $("takeProfit").addEventListener("input", updateSuggestedQuantity);
  $("stopLoss").addEventListener("input", updateSuggestedQuantity);
}

async function run(fn) {
  try {
    await fn();
  } catch (err) {
    setStatus("出错");
    alert(err.message);
  }
}

wireEvents();
boot().catch((err) => {
  setStatus("启动失败");
  alert(err.message);
});
