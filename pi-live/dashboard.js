const POLL_MS = 5000;
const UI_VERSION = "20260730-06";
const ASSET_VERSION = "20260730-history-zoom-05";
const CHART_MIN_ZOOM = 0.25;
const CHART_MAX_ZOOM = 10;
const CHART_ZOOM_STEP = 1.16;

const state = {
  latest: null,
  history: [],
  latestMotion: null,
  motionEvents: [],
  latestLight: null,
  lightReadings: [],
  system: null,
  alerts: [],
  metric: "temperature",
  chartZoom: {
    temperature: 1,
    humidity: 1,
    pressure: 1,
    light: 1,
  },
  pollTimer: null,
};

const metricConfig = {
  temperature: {
    label: "Temp",
    unit: "C",
    decimals: 1,
    color: "#e1aa4c",
    minSpan: 10,
    minZoomSpan: 0.5,
    rows: () => state.history,
    value: reading => reading.temperature,
    time: reading => reading.received_at,
  },
  humidity: {
    label: "Humidity",
    unit: "%",
    decimals: 0,
    color: "#69c18f",
    minSpan: 40,
    minZoomSpan: 2,
    minValue: 0,
    maxValue: 100,
    rows: () => state.history,
    value: reading => reading.humidity,
    time: reading => reading.received_at,
  },
  pressure: {
    label: "Pressure",
    unit: "hPa",
    decimals: 1,
    color: "#78a6d8",
    minSpan: 20,
    minZoomSpan: 1,
    rows: () => state.history,
    value: reading => reading.pressure,
    time: reading => reading.received_at,
  },
  light: {
    label: "Light",
    unit: "lux",
    decimals: 1,
    color: "#d9ce83",
    minSpan: 100,
    minZoomSpan: 5,
    minValue: 0,
    rows: () => state.lightReadings,
    value: reading => reading.lux,
    time: reading => reading.received_at,
  },
};

const severityRank = {
  critical: 3,
  warning: 2,
  info: 1,
};

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = byId(id);
  if (element) {
    element.textContent = value;
  }
}

function setClass(element, baseClass, stateClass) {
  if (!element) return;
  element.className = stateClass
    ? `${baseClass} ${stateClass}`
    : baseClass;
}

function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureCombinedShell() {
  if (byId("motionState") && byId("buildLabel")) {
    return;
  }

  const cssHref = `/static/dashboard.css?v=${ASSET_VERSION}`;
  const hasVersionedCss = Array.from(document.querySelectorAll("link[rel='stylesheet']"))
    .some(link => link.getAttribute("href") === cssHref);

  if (!hasVersionedCss) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssHref;
    document.head.appendChild(link);
  }

  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <p>SOVEREIGN EDGE</p>
          <h1>Gateway</h1>
        </div>
        <div class="top-status">
          <span id="gatewayDot" class="dot warn"></span>
          <div>
            <strong id="gatewayState">Pi Status</strong>
            <span id="syncTime">--:--:--</span>
          </div>
        </div>
      </header>

      <main>
        <section id="overviewView" class="view active" aria-labelledby="overviewTab">
          <div class="overview-grid">
            <article class="tile metric-tile">
              <span class="label">TEMP</span>
              <strong><span id="temperatureValue">--.-</span><small>C</small></strong>
              <em id="temperatureState">No data</em>
            </article>

            <article class="tile metric-tile">
              <span class="label">HUMIDITY</span>
              <strong><span id="humidityValue">--</span><small>%</small></strong>
              <em id="humidityState">No data</em>
            </article>

            <article class="tile metric-tile">
              <span class="label">PRESSURE</span>
              <strong><span id="pressureValue">----</span><small>hPa</small></strong>
              <em id="pressureState">No data</em>
            </article>

            <article class="tile state-tile">
              <span class="label">MOTION</span>
              <strong id="motionState">--</strong>
              <em id="motionTime">No data</em>
            </article>

            <article class="tile state-tile">
              <span class="label">LIGHT</span>
              <strong><span id="lightValue">--.-</span><small>lux</small></strong>
              <em id="lightState">No data</em>
            </article>

            <article class="tile node-tile">
              <span class="label">NODES</span>
              <div class="node-row">
                <span id="node1Dot" class="dot warn"></span>
                <strong>N1</strong>
                <em id="node1State">--</em>
              </div>
              <div class="node-row">
                <span id="node2Dot" class="dot warn"></span>
                <strong>N2</strong>
                <em id="node2State">--</em>
              </div>
            </article>

            <article id="alertSummary" class="tile alert-summary">
              <span class="label">ALERTS</span>
              <strong id="alertSummaryTitle">No active alerts</strong>
              <em id="alertSummaryMessage">Local rules clear</em>
            </article>
          </div>
        </section>

        <section id="historyView" class="view" aria-labelledby="historyTab">
          <div class="view-head">
            <h2>History</h2>
            <span id="historyCount">0 samples</span>
          </div>
          <div class="selector" aria-label="History metric">
            <button class="metric-button active" data-metric="temperature">Temp</button>
            <button class="metric-button" data-metric="humidity">Humidity</button>
            <button class="metric-button" data-metric="pressure">Pressure</button>
            <button class="metric-button" data-metric="light">Light</button>
            <button class="metric-button" data-metric="motion">Motion</button>
          </div>
          <div id="chartPanel" class="chart-panel">
            <canvas id="trendChart"></canvas>
            <div id="chartControls" class="chart-controls" aria-label="Chart scale controls">
              <button id="chartZoomOut" class="chart-zoom-button" type="button" aria-label="Zoom chart out">-</button>
              <button id="chartReset" class="chart-zoom-button chart-reset" type="button" aria-label="Reset chart scale">Auto</button>
              <button id="chartZoomIn" class="chart-zoom-button" type="button" aria-label="Zoom chart in">+</button>
            </div>
            <div id="chartEmpty">Waiting for data</div>
          </div>
          <div id="motionHistoryList" class="compact-list hidden"></div>
        </section>

        <section id="alertsView" class="view" aria-labelledby="alertsTab">
          <div class="view-head">
            <h2>Alerts</h2>
            <span id="alertCount">0 active</span>
          </div>
          <div id="alertsList" class="scroll-list"></div>
        </section>

        <section id="systemView" class="view" aria-labelledby="systemTab">
          <div class="view-head">
            <h2>System</h2>
            <span id="buildLabel">UI 20260730-01</span>
          </div>
          <div class="system-grid">
            <article class="tile system-tile">
              <span class="label">API</span>
              <strong id="systemApi">--</strong>
            </article>
            <article class="tile system-tile">
              <span class="label">DATABASE</span>
              <strong id="systemDatabase">--</strong>
            </article>
            <article class="tile system-tile">
              <span class="label">NODE 1</span>
              <strong id="systemNode1">--</strong>
              <em id="systemNode1Age">--</em>
            </article>
            <article class="tile system-tile">
              <span class="label">NODE 2</span>
              <strong id="systemNode2">--</strong>
              <em id="systemNode2Age">--</em>
            </article>
            <article class="tile system-tile">
              <span class="label">UPTIME</span>
              <strong id="systemUptime">--</strong>
            </article>
            <article class="tile system-tile">
              <span class="label">RECORDS</span>
              <strong id="systemRecords">--</strong>
            </article>
            <article class="tile system-tile wide">
              <span class="label">MODE</span>
              <strong>LOCAL ONLY</strong>
              <em>ESP32 -> FastAPI -> SQLite -> LCD</em>
            </article>
          </div>
        </section>
      </main>

      <nav class="bottom-nav" aria-label="Dashboard navigation">
        <button id="overviewTab" class="nav-button active" data-view="overviewView">Overview</button>
        <button id="historyTab" class="nav-button" data-view="historyView">History</button>
        <button id="alertsTab" class="nav-button" data-view="alertsView">Alerts</button>
        <button id="systemTab" class="nav-button" data-view="systemView">System</button>
      </nav>
    </div>
  `;
}

ensureCombinedShell();

function formatNumber(value, decimals = 1, fallback = "--") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return fallback;
  }

  return Number(value).toFixed(decimals);
}

function formatTime(timestamp, withSeconds = true) {
  if (!timestamp) return "No data";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Invalid time";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
  });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "No data";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Invalid time";

  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return "--";

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return "--";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function describeLight(lux) {
  if (lux === null || lux === undefined || Number.isNaN(Number(lux))) {
    return "No data";
  }

  const value = Number(lux);
  if (value < 1) return "Dark";
  if (value < 20) return "Very dim";
  if (value < 100) return "Dim";
  if (value < 300) return "Indoor light";
  if (value < 1000) return "Bright";
  return "Very bright";
}

function updateStateText(id, text, level) {
  const element = byId(id);
  if (!element) return;

  element.textContent = text;
  element.classList.remove("ok", "warn", "bad");
  if (level) {
    element.classList.add(level);
  }
}

function renderConnection(isOnline) {
  const dot = byId("gatewayDot");
  setClass(dot, "dot", isOnline ? "ok" : "bad");
  setText("gatewayState", "Pi Status");
  setText("syncTime", isOnline ? formatTime(new Date().toISOString()) : "Offline");
}

function renderOverview() {
  const reading = state.latest;
  const light = state.latestLight;
  const motion = state.latestMotion;

  setText("temperatureValue", formatNumber(reading?.temperature, 1, "--.-"));
  setText("humidityValue", formatNumber(reading?.humidity, 0, "--"));
  setText("pressureValue", formatNumber(reading?.pressure, 1, "----"));
  setText("lightValue", formatNumber(light?.lux, 1, "--.-"));

  const temperature = Number(reading?.temperature);
  const humidity = reading?.humidity == null ? null : Number(reading.humidity);
  const lux = light?.lux == null ? null : Number(light.lux);

  if (!reading) {
    updateStateText("temperatureState", "No data", "warn");
    updateStateText("humidityState", "No data", "warn");
    updateStateText("pressureState", "No data", "warn");
  } else {
    updateStateText(
      "temperatureState",
      temperature > 30 ? "High" : temperature < 10 ? "Low" : "Normal",
      temperature > 30 ? "bad" : temperature < 10 ? "warn" : "ok"
    );
    updateStateText(
      "humidityState",
      humidity === null ? "Missing" : humidity > 75 ? "High" : "Normal",
      humidity === null ? "warn" : humidity > 75 ? "warn" : "ok"
    );
    updateStateText("pressureState", "BMP280", "ok");
  }

  if (!motion) {
    setText("motionState", "--");
    updateStateText("motionTime", "No data", "warn");
    byId("motionState")?.classList.remove("motion-active");
  } else {
    const motionState = byId("motionState");
    motionState.textContent = motion.motion ? "Detected" : "Clear";
    motionState.classList.toggle("motion-active", Boolean(motion.motion));

    const lastDetection = state.motionEvents.find(event => event.motion);
    setText(
      "motionTime",
      lastDetection
        ? `Last ${formatTime(lastDetection.received_at)}`
        : `Changed ${formatTime(motion.received_at)}`
    );
  }

  updateStateText(
    "lightState",
    describeLight(lux),
    lux === null ? "warn" : lux < 20 ? "warn" : "ok"
  );

  renderNodeStatus();
  renderAlertSummary();
}

function renderNodeStatus() {
  const nodes = state.system?.nodes || {};
  const node1 = nodes.environment_node_01;
  const node2 = nodes.sensor_node_02;

  const node1Ok = node1?.status === "online";
  const node2Ok = node2?.status === "online";

  setClass(byId("node1Dot"), "dot", node1Ok ? "ok" : "bad");
  setClass(byId("node2Dot"), "dot", node2Ok ? "ok" : "bad");
  setText("node1State", node1 ? `${node1.status} ${formatAge(node1.age_seconds)}` : "--");
  setText("node2State", node2 ? `${node2.status} ${formatAge(node2.age_seconds)}` : "--");
}

function renderAlertSummary() {
  const summary = byId("alertSummary");

  if (!state.alerts.length) {
    setClass(summary, "tile alert-summary", "");
    setText("alertSummaryTitle", "No active alerts");
    setText("alertSummaryMessage", "Local rules clear");
    return;
  }

  const topAlert = [...state.alerts].sort(
    (a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0)
  )[0];

  setClass(summary, "tile alert-summary", topAlert.severity);
  setText(
    "alertSummaryTitle",
    `${topAlert.severity.toUpperCase()}: ${topAlert.alert_type.replaceAll("_", " ")}`
  );
  setText("alertSummaryMessage", topAlert.message);
}

function renderHistory() {
  setText("historyCount", `${state.history.length} env / ${state.lightReadings.length} light`);

  const isMotion = state.metric === "motion";
  byId("chartPanel").classList.toggle("hidden", isMotion);
  byId("motionHistoryList").classList.toggle("hidden", !isMotion);

  if (isMotion) {
    renderMotionHistory();
  } else {
    drawChart();
  }
}

function renderMotionHistory() {
  const list = byId("motionHistoryList");
  clearChildren(list);

  const events = state.motionEvents.slice(0, 20);

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No motion events";
    list.appendChild(empty);
    return;
  }

  for (const event of events) {
    const row = document.createElement("div");
    row.className = "list-row";

    const status = document.createElement("strong");
    status.textContent = event.motion ? "Detected" : "Clear";

    const time = document.createElement("span");
    time.textContent = formatDateTime(event.received_at);

    row.append(status, time);
    list.appendChild(row);
  }
}

function getChartZoom(metric = state.metric) {
  return state.chartZoom[metric] || 1;
}

function updateChartResetControl() {
  const button = byId("chartReset");
  const config = metricConfig[state.metric];
  if (!button || !config) return;

  const isAuto = Math.abs(getChartZoom() - 1) < 0.01;
  button.disabled = isAuto;
  button.classList.toggle("active", !isAuto);
}

function calculateChartDomain(values, config) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataCenter = (dataMin + dataMax) / 2;
  const dataSpan = Math.max(dataMax - dataMin, 0);
  const baseSpan = Math.max(dataSpan * 1.36, config.minSpan);
  const minZoomSpan = config.minZoomSpan || config.minSpan * 0.1;
  const zoomedSpan = baseSpan / getChartZoom();
  const span = Math.max(minZoomSpan, dataSpan * 1.05, zoomedSpan);

  if (
    typeof config.minValue === "number" &&
    typeof config.maxValue === "number" &&
    span >= config.maxValue - config.minValue
  ) {
    return {
      min: config.minValue,
      max: config.maxValue,
    };
  }

  let min = dataCenter - span / 2;
  let max = dataCenter + span / 2;

  if (typeof config.minValue === "number" && min < config.minValue) {
    min = config.minValue;
    max = min + span;
  }

  if (typeof config.maxValue === "number" && max > config.maxValue) {
    max = config.maxValue;
    min = max - span;
  }

  if (typeof config.minValue === "number") {
    min = Math.max(config.minValue, min);
  }

  if (typeof config.maxValue === "number") {
    max = Math.min(config.maxValue, max);
  }

  return { min, max };
}

function applyChartZoom(scale) {
  const config = metricConfig[state.metric];
  if (!config || !Number.isFinite(scale) || scale <= 0) return;

  const nextZoom = clamp(getChartZoom() * scale, CHART_MIN_ZOOM, CHART_MAX_ZOOM);
  if (Math.abs(nextZoom - getChartZoom()) < 0.001) return;

  state.chartZoom[state.metric] = nextZoom;
  updateChartResetControl();
  requestAnimationFrame(drawChart);
}

function resetChartZoom() {
  if (!metricConfig[state.metric]) return;

  state.chartZoom[state.metric] = 1;
  updateChartResetControl();
  requestAnimationFrame(drawChart);
}

function setupChartInteractions() {
  const panel = byId("chartPanel");
  if (!panel || panel.dataset.zoomReady === "true") return;

  panel.dataset.zoomReady = "true";

  panel.addEventListener("wheel", event => {
    if (!metricConfig[state.metric] || event.target.closest("button")) return;

    event.preventDefault();
    applyChartZoom(event.deltaY < 0 ? CHART_ZOOM_STEP : 1 / CHART_ZOOM_STEP);
  }, { passive: false });
}

function drawChart() {
  const canvas = byId("trendChart");
  const empty = byId("chartEmpty");
  const config = metricConfig[state.metric];

  if (!canvas || !config) return;

  updateChartResetControl();

  const rows = config.rows()
    .filter(row => config.value(row) !== null && config.value(row) !== undefined)
    .slice()
    .reverse()
    .slice(-40);

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
  canvas.height = Math.max(1, Math.floor(bounds.height * ratio));

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, bounds.width, bounds.height);

  if (rows.length < 2) {
    byId("chartControls")?.classList.add("hidden");
    empty.style.display = "grid";
    return;
  }

  byId("chartControls")?.classList.remove("hidden");
  empty.style.display = "none";

  const values = rows.map(row => Number(config.value(row)));
  const { min, max } = calculateChartDomain(values, config);

  ctx.strokeStyle = "#4a4439";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#b2aa99";
  ctx.font = "10px system-ui";

  const axisLabels = [max, (max + min) / 2, min]
    .map(label => `${label.toFixed(config.decimals)} ${config.unit}`);
  const labelWidth = Math.ceil(
    Math.max(...axisLabels.map(label => ctx.measureText(label).width))
  );

  const pad = {
    top: 28,
    right: Math.max(50, labelWidth + 12),
    bottom: 20,
    left: 10,
  };
  const width = bounds.width - pad.left - pad.right;
  const height = bounds.height - pad.top - pad.bottom;

  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (height / 3) * i;
    const label = max - ((max - min) / 3) * i;

    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + width, y);
    ctx.stroke();
    ctx.fillText(`${label.toFixed(config.decimals)} ${config.unit}`, pad.left + width + 5, y + 3);
  }

  const points = values.map((value, index) => ({
    x: pad.left + (index / (values.length - 1)) * width,
    y: pad.top + ((max - value) / (max - min)) * height,
  }));

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, width, height);
  ctx.clip();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = config.color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = config.color;
  const lastPoint = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#b2aa99";
  ctx.textAlign = "left";
  ctx.fillText(config.label, pad.left, bounds.height - 6);
  ctx.textAlign = "right";
  ctx.fillText(formatTime(config.time(rows[rows.length - 1]), false), pad.left + width, bounds.height - 6);
  ctx.textAlign = "left";
}

function renderAlerts() {
  const list = byId("alertsList");
  clearChildren(list);
  setText("alertCount", `${state.alerts.length} active`);

  if (!state.alerts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No active alerts";
    list.appendChild(empty);
    return;
  }

  const alerts = [...state.alerts].sort(
    (a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0)
  );

  for (const alert of alerts) {
    const row = document.createElement("article");
    row.className = `alert-row ${alert.severity}`;

    const content = document.createElement("div");
    const title = document.createElement("strong");
    const message = document.createElement("p");
    const meta = document.createElement("span");

    title.textContent = `${alert.severity.toUpperCase()} ${alert.alert_type.replaceAll("_", " ")}`;
    message.textContent = alert.message;
    meta.textContent = `${alert.device || "gateway"} - ${formatDateTime(alert.created_at)}`;

    content.append(title, message, meta);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = alert.acknowledged ? "ACKED" : "ACK";
    button.disabled = alert.acknowledged;
    button.addEventListener("click", () => acknowledgeAlert(alert.id));

    row.append(content, button);
    list.appendChild(row);
  }
}

function renderSystem() {
  const system = state.system;

  if (!system) {
    setText("systemApi", "--");
    setText("systemDatabase", "--");
    setText("systemNode1", "--");
    setText("systemNode2", "--");
    setText("systemUptime", "--");
    setText("systemRecords", "--");
    return;
  }

  const database = system.database || {};
  const node1 = system.nodes?.environment_node_01;
  const node2 = system.nodes?.sensor_node_02;

  setText("systemApi", system.api?.status?.toUpperCase() || "--");
  setText("systemDatabase", database.status?.toUpperCase() || "--");
  setText("systemNode1", node1?.status?.toUpperCase() || "--");
  setText("systemNode1Age", node1 ? `Seen ${formatAge(node1.age_seconds)} ago` : "--");
  setText("systemNode2", node2?.status?.toUpperCase() || "--");
  setText("systemNode2Age", node2 ? `Seen ${formatAge(node2.age_seconds)} ago` : "--");
  setText("systemUptime", formatUptime(system.gateway?.uptime_seconds));
  setText(
    "systemRecords",
    `${database.sensor_readings ?? 0}/${database.motion_events ?? 0}/${database.light_readings ?? 0}`
  );

  updateStateText("systemApi", byId("systemApi").textContent, system.api?.status === "online" ? "ok" : "bad");
  updateStateText("systemDatabase", byId("systemDatabase").textContent, database.status === "online" ? "ok" : "bad");
  updateStateText("systemNode1", byId("systemNode1").textContent, node1?.status === "online" ? "ok" : "bad");
  updateStateText("systemNode2", byId("systemNode2").textContent, node2?.status === "online" ? "ok" : "bad");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

async function refreshDashboard() {
  try {
    const [
      health,
      latest,
      history,
      motionLatest,
      motionHistory,
      lightLatest,
      lightHistory,
      system,
      alerts,
    ] = await Promise.all([
      fetchJson("/health"),
      fetchJson("/latest"),
      fetchJson("/history?limit=80"),
      fetchJson("/motion/latest"),
      fetchJson("/motion/history?limit=80"),
      fetchJson("/light/latest"),
      fetchJson("/light/history?limit=80"),
      fetchJson("/system/status"),
      fetchJson("/alerts"),
    ]);

    state.latest = latest.latest_reading;
    state.history = history.readings || [];
    state.latestMotion = motionLatest.latest_motion;
    state.motionEvents = motionHistory.events || [];
    state.latestLight = lightLatest.latest_light;
    state.lightReadings = lightHistory.readings || [];
    state.system = system;
    state.alerts = alerts.alerts || [];

    renderConnection(health.status === "ok");
    renderOverview();
    renderHistory();
    renderAlerts();
    renderSystem();
  } catch (error) {
    renderConnection(false);
    console.error("Dashboard refresh failed:", error);
  }
}

async function acknowledgeAlert(alertId) {
  try {
    await fetchJson(`/alerts/${alertId}/acknowledge`, {
      method: "POST",
    });
  } catch (error) {
    console.error("Alert acknowledgement failed:", error);
    return;
  }

  await refreshDashboard();
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-button").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));

    button.classList.add("active");
    byId(button.dataset.view).classList.add("active");

    if (button.dataset.view === "historyView") {
      requestAnimationFrame(renderHistory);
    }
  });
});

document.querySelectorAll(".metric-button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".metric-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    state.metric = button.dataset.metric;
    renderHistory();
  });
});

byId("chartReset")?.addEventListener("click", resetChartZoom);
byId("chartZoomOut")?.addEventListener("click", () => applyChartZoom(1 / CHART_ZOOM_STEP));
byId("chartZoomIn")?.addEventListener("click", () => applyChartZoom(CHART_ZOOM_STEP));
setupChartInteractions();

window.addEventListener("resize", () => {
  if (byId("historyView").classList.contains("active")) {
    requestAnimationFrame(renderHistory);
  }
});

setText("buildLabel", `UI ${UI_VERSION}`);
refreshDashboard();
state.pollTimer = window.setInterval(refreshDashboard, POLL_MS);
