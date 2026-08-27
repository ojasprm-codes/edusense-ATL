/**
 * EDUSENSE AI V7 Dashboard Controller
 * Backend remains authoritative; frontend focuses on smooth rendering.
 */

'use strict';

const CONFIG = {
  apiEndpoint: '/api/sensors',
  systemEndpoint: '/api/system',
  systemHistoryEndpoint: '/api/system/history',
  healthEndpoint: '/api/health',
  databaseEraseEndpoint: '/api/database/erase',
  networkResetEndpoint: '/api/setup/reset-network',
  historyEndpoint: '/api/history',
  analyticsEndpoint: '/api/analytics',
  eventsEndpoint: '/api/events',
  sensorSummaryEndpoint: '/api/sensor',
  powerEndpoint: '/api/power',
  bootEndpoint: '/api/boot',
  aiReportEndpoint: '/api/ai/report',
  pollInterval: 1000,
  systemPollInterval: 3000,
  liveChartUpdateMs: 1000,
  chartMaxPoints: {
    live: 900,
    '2h': 7500,
    '5h': 360,
    '1d': 320,
    '20d': 520,
    '2m': 90,
    today: 320,
    yesterday: 320,
    calendar: 900,
    custom: 1200,
  },
};

const STATUS_RANK = { CALIBRATING: 0, SAFE: 1, ELEVATED: 2, WARNING: 3, DANGER: 4 };
const GAS_SENSOR_IDS = ['mq2', 'mq3', 'mq4', 'mq5', 'mq7', 'mq8'];
const GAS_SENSOR_LABELS = {
  gas: 'Gas Average',
  temp: 'Temperature',
  hum: 'Humidity',
  mq2: 'Smoke',
  mq3: 'Alcohol Vapor',
  mq4: 'Methane',
  mq5: 'LPG',
  mq7: 'Carbon Monoxide',
  mq8: 'Hydrogen',
};
const CHART_SENSOR_UNITS = {
  gas: ' ppm est.',
  temp: ' C',
  hum: ' %',
  mq2: ' ppm est.',
  mq3: ' ppm est.',
  mq4: ' ppm est.',
  mq5: ' ppm est.',
  mq7: ' ppm est.',
  mq8: ' ppm est.',
};
const SYSTEM_METRIC_LABELS = {
  cpu_temp: 'CPU Temperature',
  cpu_usage: 'CPU Usage',
  ram_usage: 'RAM Usage',
  disk_usage: 'Disk Usage',
};
const SYSTEM_METRIC_UNITS = {
  cpu_temp: ' C',
  cpu_usage: ' %',
  ram_usage: ' %',
  disk_usage: ' %',
};

let envChart = null;
let soloSensorChart = null;
let activeRange = 'live';
let activeChartMode = 'environment';
let activeSoloSensor = null;
let focusedChartSensor = null;
let activeSystemMetric = null;
let selectedDate = toDateInputValue(new Date());
let latestCalibration = null;
let calibrationClockAnchor = null;
let latestHealth = null;
let latestSensorData = null;
let latestSystemInfo = null;
let latestHistoryQuery = '';
let latestEvents = [];
let lastChartUpdateAt = 0;
let apiFailureCount = 0;

const inflight = {
  sensors: false,
  system: false,
  health: false,
  history: false,
  analytics: false,
  events: false,
  power: false,
  solo: false,
};

const domCache = new Map();
const valueCache = new Map();
const chartData = {
  labels: [],
  temp: [],
  hum: [],
  gas: [],
  system: [],
  mq2: [],
  mq3: [],
  mq4: [],
  mq5: [],
  mq7: [],
  mq8: [],
  timestamps: [],
  contexts: [],
  statuses: [],
};

document.addEventListener('DOMContentLoaded', () => {
  safeInit(initClock, 'clock');
  safeInit(initBootScreen, 'boot');
  safeInit(initChart, 'chart');
  safeInit(initHistoryControls, 'history controls');
  safeInit(initSensorCards, 'sensor cards');
  safeInit(initSystemControls, 'system controls');
  safeInit(initAiReport, 'AI report');
  safeInit(initRenderLoop, 'render loop');
  schedulePoll('sensors', fetchSensorData, CONFIG.pollInterval);
  schedulePoll('system', fetchSystemInfo, CONFIG.systemPollInterval);
  schedulePoll('health', fetchHealthStatus, CONFIG.systemPollInterval);
  schedulePoll('power', fetchPowerInfo, 10000);
  fetchHistoricalData();
  fetchAnalytics();
  fetchEvents();
});

function safeInit(fn, name) {
  try {
    fn();
  } catch (error) {
    console.error(`[EDUSENSE] ${name} initialization failed`, error);
  }
}

function initClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function initRenderLoop() {
  const tick = () => {
    renderCalibrationFromTimestamp();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function schedulePoll(key, fn, interval) {
  const run = async () => {
    if (!inflight[key]) await fn();
    setTimeout(run, interval);
  };
  run();
}

function initSensorCards() {
  document.querySelectorAll('.sensor-card[data-sensor]').forEach((card) => {
    card.addEventListener('click', () => openSensorModal(card.dataset.sensor));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSensorModal(card.dataset.sensor);
      }
    });
  });
  const close = getEl('sensorModalClose');
  if (close) close.addEventListener('click', closeSensorModal);
  const modal = getEl('sensorModal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeSensorModal();
    });
  }
}

function initSystemControls() {
  document.querySelectorAll('.system-item[data-system-metric]').forEach((item) => {
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.addEventListener('click', () => selectSystemMetric(item.dataset.systemMetric));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectSystemMetric(item.dataset.systemMetric);
      }
    });
  });
  getEl('eraseDatabaseButton')?.addEventListener('click', eraseDatabaseDetails);
  getEl('resetNetworkButton')?.addEventListener('click', resetNetworkSetup);
}

async function resetNetworkSetup() {
  const confirmation = window.prompt('This disconnects the Pi from the current WiFi and starts the EDUSENSE setup hotspot. Type RESET NETWORK to continue.');
  if (confirmation !== 'RESET NETWORK') return;
  try {
    const response = await fetch(CONFIG.networkResetEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: confirmation }),
    });
    const result = await response.json();
    if (!response.ok || !result.accepted) {
      window.alert(result.error || 'Network reset failed.');
      return;
    }
    window.alert('Network reset started. This page will disconnect. Connect your phone or laptop to the EDUSENSE setup WiFi, then open http://10.42.0.1/setup. Cloud enrollment and sensor history are preserved.');
  } catch {
    window.alert('The Pi disconnected while starting setup mode. Connect to the EDUSENSE setup WiFi and open http://10.42.0.1/setup.');
  }
}

function updateClock() {
  const now = new Date();
  setText('liveClock', formatTime(now));
  const clockEl = getEl('liveClock');
  if (clockEl) clockEl.setAttribute('datetime', now.toISOString());
  const dateEl = getEl('liveDate');
  if (dateEl) {
    const dateText = now.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    setText('liveDate', dateText);
    dateEl.setAttribute('datetime', now.toISOString().split('T')[0]);
  }
}

function initBootScreen() {
  renderBootTimeline([]);
  fetchBootState();
}

async function fetchBootState() {
  try {
    const response = await fetch(CONFIG.bootEndpoint);
    if (!response.ok) throw new Error('Boot API unavailable');
    const data = await response.json();
    renderBootTimeline(data.timeline || [], Number(data.progress) || 0);
    startBootRender(data);
  } catch {
    hideElement('bootScreen', 'boot-screen--hidden');
  }
}

function startBootRender(data) {
  const startedMs = secondsToMs(data.boot_started_at);
  const endMs = secondsToMs(data.estimated_completion_time);
  const durationMs = Math.max(1, endMs - startedMs);

  const render = () => {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - startedMs);
    const remainingMs = Math.max(0, endMs - now);
    const progress = Math.min(100, (elapsedMs / durationMs) * 100);
    setText('bootCurrentTime', formatTime(new Date()));
    setText('bootStarted', formatTime(new Date(startedMs)));
    setText('bootEta', formatTime(new Date(endMs)));
    setText('bootElapsed', `${Math.floor(elapsedMs / 1000)}s`);
    setText('bootRemaining', `${Math.ceil(remainingMs / 1000)}s`);
    setText('bootProgressText', `${Math.round(progress)}%`);
    setWidth('bootBarFill', progress);
    setRingProgress('bootScreen', progress);
    updateBootTimelineState(progress);
    if (progress >= 100) {
      hideElement('bootScreen', 'boot-screen--hidden');
      return;
    }
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}

function renderBootTimeline(items, progress = 0) {
  const timeline = getEl('bootTimeline');
  if (!timeline) return;
  const defaults = [
    'Initializing System',
    'Loading Database',
    'Loading Historical Records',
    'Connecting Arduino',
    'Checking USB Serial',
    'Loading Safety Checks',
    'Preparing Dashboard',
    'Calibrating Sensors',
    'Ready',
  ];
  const steps = items.length ? items : defaults;
  timeline.innerHTML = steps.map((item) => `<li>${item}</li>`).join('');
  updateBootTimelineState(progress);
}

function updateBootTimelineState(progress) {
  const timeline = getEl('bootTimeline');
  if (!timeline) return;
  const steps = Array.from(timeline.children);
  if (!steps.length) return;
  const activeIndex = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));
  steps.forEach((item, index) => {
    item.classList.toggle('is-done', index < activeIndex);
    item.classList.toggle('is-active', index === activeIndex);
  });
}

function initChart() {
  const canvas = getEl('envChart');
  if (!canvas) return;
  if (!window.Chart) {
    showChartMessage('Chart engine unavailable. Live values will continue updating.');
    return;
  }
  const ctx = canvas.getContext('2d');
  const gradientTemp = ctx.createLinearGradient(0, 0, 0, 300);
  gradientTemp.addColorStop(0, 'rgba(255, 138, 128, 0.3)');
  gradientTemp.addColorStop(1, 'rgba(255, 138, 128, 0)');
  const gradientHum = ctx.createLinearGradient(0, 0, 0, 300);
  gradientHum.addColorStop(0, 'rgba(0, 153, 255, 0.3)');
  gradientHum.addColorStop(1, 'rgba(0, 153, 255, 0)');
  const gradientGas = ctx.createLinearGradient(0, 0, 0, 300);
  gradientGas.addColorStop(0, 'rgba(0, 229, 255, 0.3)');
  gradientGas.addColorStop(1, 'rgba(0, 229, 255, 0)');
  envChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [
        { label: 'Temperature (C)', data: chartData.temp, borderColor: '#FF8A80', backgroundColor: gradientTemp, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#FF8A80' },
        { label: 'Humidity (%)', data: chartData.hum, borderColor: '#0099FF', backgroundColor: gradientHum, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#0099FF' },
        { label: 'Estimated Gas Concentration (ppm)', data: chartData.gas, borderColor: '#00E5FF', backgroundColor: gradientGas, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#00E5FF' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: false,
          onClick: (_event, legendItem, legend) => {
            const chart = legend.chart;
            chart.setDatasetVisibility(legendItem.datasetIndex, !chart.isDatasetVisible(legendItem.datasetIndex));
            chart.update('none');
          },
        },
        tooltip: {
          backgroundColor: 'rgba(11, 18, 32, 0.9)',
          titleColor: '#FFFFFF',
          bodyColor: 'rgba(255, 255, 255, 0.8)',
          borderColor: 'rgba(0, 229, 255, 0.2)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          titleFont: { family: 'Poppins', weight: '600' },
          bodyFont: { family: 'Poppins' },
          callbacks: {
            title(items) {
              const index = items[0]?.dataIndex ?? 0;
              const ts = chartData.timestamps[index];
              return ts ? formatDateTime(new Date(ts)) : '';
            },
            afterBody(items) {
              const index = items[0]?.dataIndex ?? 0;
              const status = chartData.statuses[index];
              const context = chartData.contexts[index];
              const lines = [];
              if (status) lines.push(`Status: ${status}`);
              if (context && context !== 'selected') lines.push(`Context: ${context}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false }, ticks: { color: 'rgba(255, 255, 255, 0.35)', font: { family: 'Poppins', size: 10 }, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false }, ticks: { color: 'rgba(255, 255, 255, 0.35)', font: { family: 'Poppins', size: 10 } } },
      },
      animation: { duration: 0 },
    },
  });
}

function initSoloSensorChart() {
  const canvas = getEl('soloSensorChart');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(0, 229, 255, 0.32)');
  gradient.addColorStop(1, 'rgba(0, 229, 255, 0)');
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Sensor Reading', data: [], borderColor: '#00E5FF', backgroundColor: gradient, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.35)', maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.35)' } },
      },
      animation: { duration: 0 },
    },
  });
}

function initHistoryControls() {
  getEl('dateHistoryPanel')?.classList.add('date-history-panel--hidden');
  getEl('customRangePanel')?.classList.add('date-history-panel--hidden');
  setDateInput(selectedDate);

  document.querySelectorAll('.history-controls__btn[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      const range = button.dataset.range || 'live';
      if (range === 'custom') {
        activeRange = 'custom';
        toggleRangePanels();
        setActiveHistoryButton(button);
        return;
      }
      activeRange = range;
      if (range === 'calendar') selectedDate = getEl('historyDateInput')?.value || selectedDate;
      if (range === 'today') selectedDate = toDateInputValue(new Date());
      if (range === 'yesterday') selectedDate = shiftDate(toDateInputValue(new Date()), -1);
      setDateInput(selectedDate);
      setActiveHistoryButton(button);
      loadSelectedHistory();
    });
  });

  getEl('historyDateInput')?.addEventListener('change', (event) => {
    selectedDate = event.target.value || selectedDate;
    activeRange = 'calendar';
    setActiveRangeByName('calendar');
    loadSelectedHistory();
  });
  getEl('previousDayButton')?.addEventListener('click', () => changeSelectedDay(-1));
  getEl('nextDayButton')?.addEventListener('click', () => changeSelectedDay(1));
  getEl('dayWindowSelect')?.addEventListener('change', loadSelectedHistory);
  getEl('midnightContextToggle')?.addEventListener('change', loadSelectedHistory);
  getEl('applyCustomRangeButton')?.addEventListener('click', loadSelectedHistory);
  document.querySelectorAll('.chart-sensor-selector__btn[data-chart-sensor]').forEach((button) => {
    button.addEventListener('click', () => selectChartSensor(button.dataset.chartSensor || 'gas'));
  });
}

function initAiReport() {
  getEl('generateAiReport')?.addEventListener('click', fetchAiReport);
}

async function fetchAiReport() {
  const button = getEl('generateAiReport');
  if (button) button.disabled = true;
  setText('aiText', 'Preparing an evidence-based report for the selected range...');
  try {
    const response = await fetch(CONFIG.aiReportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: Object.fromEntries(new URLSearchParams(buildRangeQuery())) }),
    });
    if (!response.ok) throw new Error('AI report unavailable');
    const data = await response.json();
    setText('aiText', data.report || 'No report was returned.');
    setText('aiSource', `${data.source || 'EDUSENSE local engine'} | ${String(data.range || activeRange).toUpperCase()}`);
  } catch {
    setText('aiText', 'The narrative service is unavailable. Deterministic safety monitoring remains active and authoritative.');
    setText('aiSource', 'Safety engine online');
  } finally {
    if (button) button.disabled = false;
  }
}

function setActiveHistoryButton(button) {
  document.querySelectorAll('.history-controls__btn[data-range]').forEach((item) => {
    item.classList.toggle('history-controls__btn--active', item === button);
  });
}

function setActiveRangeByName(range) {
  const button = document.querySelector(`.history-controls__btn[data-range="${range}"]`);
  if (button) setActiveHistoryButton(button);
}

function toggleRangePanels() {
  const showDay = ['calendar', 'today', 'yesterday'].includes(activeRange);
  const showCustom = activeRange === 'custom';
  getEl('dateHistoryPanel')?.classList.toggle('date-history-panel--hidden', !showDay);
  getEl('customRangePanel')?.classList.toggle('date-history-panel--hidden', !showCustom);
}

function changeSelectedDay(delta) {
  selectedDate = shiftDate(selectedDate, delta);
  setDateInput(selectedDate);
  activeRange = 'calendar';
  setActiveRangeByName('calendar');
  loadSelectedHistory();
}

function setDateInput(value) {
  const input = getEl('historyDateInput');
  if (input) input.value = value;
  const label = getEl('selectedDateLabel');
  if (label) label.textContent = formatSelectedDate(value);
}

function loadSelectedHistory() {
  toggleRangePanels();
  if (activeChartMode === 'system') {
    fetchSystemHistoricalData();
  } else {
    fetchHistoricalData();
  }
  fetchAnalytics();
  fetchEvents();
  if (activeSoloSensor) fetchSensorSummary(activeSoloSensor);
}

function buildRangeQuery() {
  const params = new URLSearchParams();
  if (['calendar', 'today', 'yesterday'].includes(activeRange)) {
    params.set('range', activeRange === 'calendar' ? 'day' : activeRange);
    params.set('date', selectedDate);
    params.set('hours', getEl('dayWindowSelect')?.value || '24');
    params.set('context', getEl('midnightContextToggle')?.checked ? 'both' : 'none');
  } else if (activeRange === 'custom') {
    params.set('range', 'custom');
    const start = getEl('customStartInput')?.value;
    const end = getEl('customEndInput')?.value;
    if (start) params.set('start', new Date(start).toISOString());
    if (end) params.set('end', new Date(end).toISOString());
  } else {
    params.set('range', activeRange);
  }
  return params.toString();
}

function formatChartLabel(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const longRange = ['20d', '2m'].includes(activeRange);
  const options = longRange
    ? { month: 'short', day: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: ['live', '2h'].includes(activeRange) ? '2-digit' : undefined };
  return date.toLocaleString('en-IN', options);
}

function setChartHistory(readings) {
  if (calibrationIsActive() && activeChartMode === 'environment') {
    clearChartArrays();
    refreshMainChartDataset();
    showChartMessage('Graph recording starts after sensor calibration completes.');
    if (envChart) envChart.update('none');
    return;
  }
  const visibleReadings = (readings || []).filter((reading) => !isCalibrationReading(reading));
  clearChartArrays();
  visibleReadings.forEach((reading) => appendChartPoint(reading, false));
  refreshMainChartDataset();
  getEl('chartEmptyState')?.classList.toggle('chart-empty-state--visible', visibleReadings.length === 0);
  if (envChart) envChart.update('none');
}

function clearChartArrays() {
  chartData.labels.length = 0;
  chartData.temp.length = 0;
  chartData.hum.length = 0;
  chartData.gas.length = 0;
  chartData.system.length = 0;
  chartData.mq2.length = 0;
  chartData.mq3.length = 0;
  chartData.mq4.length = 0;
  chartData.mq5.length = 0;
  chartData.mq7.length = 0;
  chartData.mq8.length = 0;
  chartData.timestamps.length = 0;
  chartData.contexts.length = 0;
  chartData.statuses.length = 0;
}

function updateChartFromReading(reading) {
  if (activeChartMode !== 'environment') return;
  if (!['live', '2h'].includes(activeRange)) return;
  if (isCalibrationReading(reading)) {
    if (chartData.timestamps.length) {
      clearChartArrays();
      refreshMainChartDataset();
      if (envChart) envChart.update('none');
    }
    showChartMessage('Graph recording starts after sensor calibration completes.');
    return;
  }
  appendChartPoint(reading, true);
}

function appendChartPoint(reading, shouldUpdate) {
  if (isCalibrationReading(reading)) return;
  const timestamp = reading.timestamp || new Date().toISOString();
  if (chartData.timestamps.includes(timestamp)) return;
  chartData.labels.push(formatChartLabel(timestamp));
  chartData.temp.push(Number(reading.temp) || 0);
  chartData.hum.push(Number(reading.hum) || 0);
  chartData.gas.push(Number(reading.gas) || 0);
  chartData.mq2.push(Number(reading.mq2) || 0);
  chartData.mq3.push(Number(reading.mq3) || 0);
  chartData.mq4.push(Number(reading.mq4) || 0);
  chartData.mq5.push(Number(reading.mq5) || 0);
  chartData.mq7.push(Number(reading.mq7) || 0);
  chartData.mq8.push(Number(reading.mq8) || 0);
  chartData.timestamps.push(timestamp);
  chartData.contexts.push(reading.context || 'selected');
  chartData.statuses.push(reading.status || '');
  getEl('chartEmptyState')?.classList.remove('chart-empty-state--visible');
  const maxPoints = CONFIG.chartMaxPoints[activeRange] || 1200;
  while (chartData.labels.length > maxPoints) {
    chartData.labels.shift();
    chartData.temp.shift();
    chartData.hum.shift();
    chartData.gas.shift();
    chartData.mq2.shift();
    chartData.mq3.shift();
    chartData.mq4.shift();
    chartData.mq5.shift();
    chartData.mq7.shift();
    chartData.mq8.shift();
    chartData.timestamps.shift();
    chartData.contexts.shift();
    chartData.statuses.shift();
  }
  refreshMainChartDataset();
  if (shouldUpdate && envChart) {
    const now = performance.now();
    if (now - lastChartUpdateAt >= CONFIG.liveChartUpdateMs) {
      envChart.update('none');
      lastChartUpdateAt = now;
    }
  }
}

function isCalibrationReading(reading) {
  const calibrationActive = Boolean(reading?.calibration?.active) && remainingFromCalibration(reading.calibration) > 0;
  return calibrationActive || (String(reading?.status || '').toUpperCase() === 'CALIBRATING' && calibrationActive);
}

function calibrationIsActive() {
  return Boolean(latestCalibration?.active) && remainingFromCalibration(latestCalibration) > 0;
}

function refreshMainChartDataset() {
  if (!envChart) return;
  if (activeChartMode === 'system') {
    envChart.data.labels = chartData.labels;
    envChart.data.datasets[0].data = [];
    envChart.data.datasets[1].data = [];
    envChart.data.datasets[2].data = chartData.system;
    envChart.data.datasets[2].label = `${SYSTEM_METRIC_LABELS[activeSystemMetric] || 'System Metric'}${SYSTEM_METRIC_UNITS[activeSystemMetric] || ''}`;
    envChart.data.datasets[0].hidden = true;
    envChart.data.datasets[1].hidden = true;
    envChart.data.datasets[2].hidden = false;
    applyYAxisFit([chartData.system], activeSystemMetric);
    updateChartMetricStats();
    return;
  }
  const selected = focusedChartSensor || 'gas';
  const selectedDataset = chartData[selected] || chartData.gas;
  envChart.data.labels = chartData.labels;
  envChart.data.datasets[0].data = chartData.temp;
  envChart.data.datasets[1].data = chartData.hum;
  envChart.data.datasets[2].data = selectedDataset;
  envChart.data.datasets[2].label = focusedChartSensor
    ? `${GAS_SENSOR_LABELS[focusedChartSensor] || focusedChartSensor.toUpperCase()} Raw response`
    : 'Gas Sensor Average';
  envChart.data.datasets[0].hidden = Boolean(focusedChartSensor) && focusedChartSensor !== 'temp';
  envChart.data.datasets[1].hidden = Boolean(focusedChartSensor) && focusedChartSensor !== 'hum';
  envChart.data.datasets[2].hidden = focusedChartSensor === 'temp' || focusedChartSensor === 'hum';
  const visibleSeries = [];
  if (!envChart.data.datasets[0].hidden) visibleSeries.push(chartData.temp);
  if (!envChart.data.datasets[1].hidden) visibleSeries.push(chartData.hum);
  if (!envChart.data.datasets[2].hidden) visibleSeries.push(selectedDataset);
  applyYAxisFit(visibleSeries, selected);
  updateChartMetricStats();
}

function updateChartMetricStats() {
  const metricKey = activeChartMode === 'system' ? 'system' : focusedChartSensor || 'gas';
  const values = (chartData[metricKey] || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const label = activeChartMode === 'system'
    ? SYSTEM_METRIC_LABELS[activeSystemMetric] || 'System Metric'
    : GAS_SENSOR_LABELS[metricKey] || 'Gas Average';
  const unit = activeChartMode === 'system' ? SYSTEM_METRIC_UNITS[activeSystemMetric] || '' : CHART_SENSOR_UNITS[metricKey] || ' ppm est.';
  setText('chartMetricLabel', label);
  setText('chartMetricSamples', `${values.length} sample${values.length === 1 ? '' : 's'}`);
  if (!values.length) {
    setText('chartMetricAvg', '--');
    setText('chartMetricMin', '--');
    setText('chartMetricMax', '--');
    return;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  const avg = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  setText('chartMetricAvg', formatMetric(avg, unit));
  setText('chartMetricMin', formatMetric(min, unit));
  setText('chartMetricMax', formatMetric(max, unit));
}

function applyYAxisFit(seriesList, metricKey) {
  if (!envChart) return;
  let values = seriesList
    .flat()
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (['temp', 'hum', 'cpu_temp'].includes(metricKey)) {
    const nonZero = values.filter((value) => value > 0);
    if (nonZero.length) values = nonZero;
  }
  if (!values.length) {
    envChart.options.scales.y.min = undefined;
    envChart.options.scales.y.max = undefined;
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, Math.max(Math.abs(max) * 0.08, 1));
  const padding = span * 0.18;
  envChart.options.scales.y.min = Math.max(0, min - padding);
  envChart.options.scales.y.max = max + padding;
}

function updateSensor(id, value, decimals = 1) {
  setText(id, formatNumber(value, decimals));
}

function updateSensorStatus(sensorId, status, analyses = []) {
  const card = document.querySelector(`[data-sensor="${sensorId}"]`);
  if (!card) return;
  const indicator = card.querySelector('.status-indicator');
  const statusText = card.querySelector('.sensor-card__status-text');
  if (!indicator) return;
  const analysis = analyses.find((item) => item.sensor === sensorId);
  const systemStatus = String(status || 'SAFE').toUpperCase();
  let level = systemStatus === 'CALIBRATING' ? 'calibrating' : 'safe';
  let text = systemStatus === 'CALIBRATING' ? 'Calibrating' : sensorId.startsWith('mq') ? 'Clear' : 'Normal';
  const sensorSeverity = String(analysis?.severity || 'SAFE').toUpperCase();
  const systemRank = STATUS_RANK[systemStatus] ?? STATUS_RANK.SAFE;
  const sensorRank = STATUS_RANK[sensorSeverity] ?? STATUS_RANK.SAFE;
  const effectiveRank = Math.min(systemRank, sensorRank);
  if (effectiveRank > STATUS_RANK.SAFE) {
    level = Object.keys(STATUS_RANK).find((key) => STATUS_RANK[key] === effectiveRank).toLowerCase();
    text = level === 'danger' ? 'Critical' : level === 'warning' ? 'Elevated' : 'Watch';
  }
  const nextClass = `status-indicator status-indicator--${level}`;
  if (indicator.className !== nextClass) indicator.className = nextClass;
  if (statusText && statusText.textContent !== text) statusText.textContent = text;
}

function updateOverallStatus(data) {
  const status = String(data.status || 'CALIBRATING').toUpperCase();
  const statusEl = getEl('status');
  if (statusEl) {
    setText('status', status);
    const nextClass = `status-badge status-badge--${status.toLowerCase()}`;
    if (statusEl.className !== nextClass) statusEl.className = nextClass;
  }
  const aiEl = getEl('aiText');
  if (aiEl) {
    const html = buildAiRecommendation(status, data);
    if (aiEl.innerHTML !== html) aiEl.innerHTML = html;
  }
  ['temp', 'hum', 'mq2', 'mq3', 'mq4', 'mq5', 'mq7', 'mq8'].forEach((sensorId) => {
    updateSensorStatus(sensorId, status, data.analyses || []);
  });
}

function buildAiRecommendation(status, data) {
  const systemAdvisory = buildSystemAdvisory(latestSystemInfo);
  if (status === 'CALIBRATING') {
    const remaining = latestCalibration ? remainingFromCalibration(latestCalibration) : data.calibration?.remaining_seconds ?? 200;
    return [
      'Calibration in progress.',
      `${remaining}s remaining while EDUSENSE builds a clean-air reference.`,
      'Keep the room conditions stable until decisions are enabled.',
      systemAdvisory,
    ].filter(Boolean).join('<br>');
  }
  if (status === 'SAFE') {
    return [
      'Air quality is stable within the calibrated baseline.',
      'Maintain normal ventilation and continue routine observation.',
      systemAdvisory,
    ].filter(Boolean).join('<br>');
  }
  if (status === 'ELEVATED') {
    return [
      '<strong class="recommendation-level recommendation-level--elevated">Elevated trend detected.</strong>',
      data.reason || 'A gas channel is moving above its learned baseline.',
      'Increase ventilation and watch for a sustained rise before class activity continues.',
      systemAdvisory,
    ].filter(Boolean).join('<br>');
  }
  if (status === 'WARNING') {
    return [
      '<strong class="recommendation-level recommendation-level--warning">Warning condition.</strong>',
      data.reason || 'Air quality is significantly above the calibrated baseline.',
      'Notify the responsible teacher, ventilate the room, and inspect likely sources.',
      systemAdvisory,
    ].filter(Boolean).join('<br>');
  }
  return [
    '<strong class="recommendation-level recommendation-level--danger">Danger condition.</strong>',
    data.reason || 'A critical air-quality change has been detected.',
    'Move occupants away, ventilate immediately, and inspect the source before resetting the system.',
    systemAdvisory,
  ].filter(Boolean).join('<br>');
}

function buildSystemAdvisory(info) {
  if (!info) return '';
  const cpuTemp = Number(info.cpu_temp) || 0;
  const cpuUsage = Number(info.cpu_usage) || 0;
  const ramUsage = Number(info.ram_usage) || 0;
  const diskUsage = Number(info.disk_usage) || 0;
  const notes = [];
  if (cpuTemp >= 80) notes.push('System advisory: Pi CPU temperature is in the danger range; improve airflow or reduce load.');
  else if (cpuTemp >= 75) notes.push('System advisory: Pi CPU temperature is elevated; monitor cooling.');
  if (cpuUsage >= 90) notes.push('CPU load is very high; dashboard response may slow.');
  if (ramUsage >= 90) notes.push('Memory pressure is high; avoid extra browser tabs or background tasks.');
  if (diskUsage >= 90) notes.push('Storage is nearly full; export or archive data soon.');
  return notes.join(' ');
}

function updateCalibrationOverlay(calibration) {
  if (!calibration) return;
  latestCalibration = calibration;
  const remainingSeconds = Number(calibration.remaining_seconds);
  const elapsedSeconds = Number(calibration.elapsed_seconds);
  const durationSeconds = Number(calibration.duration_seconds);
  calibrationClockAnchor = {
    receivedAt: Date.now(),
    remainingMs: Number.isFinite(remainingSeconds) ? Math.max(0, remainingSeconds * 1000) : null,
    elapsedSeconds: Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0,
    durationSeconds: Number.isFinite(durationSeconds) ? Math.max(1, durationSeconds) : 200,
  };
  renderCalibrationFromTimestamp();
}

function renderCalibrationFromTimestamp() {
  const overlay = getEl('calibrationOverlay');
  if (!overlay || !latestCalibration) return;
  const now = Date.now();
  const sinceUpdateMs = calibrationClockAnchor ? Math.max(0, now - calibrationClockAnchor.receivedAt) : 0;
  const etaFromApi = Date.parse(latestCalibration.estimated_completion_time);
  const fallbackRemainingMs = Number.isFinite(etaFromApi) ? Math.max(0, etaFromApi - now) : 0;
  const anchoredRemainingMs = calibrationClockAnchor?.remainingMs;
  const remainingMs = anchoredRemainingMs === null || anchoredRemainingMs === undefined
    ? fallbackRemainingMs
    : Math.max(0, anchoredRemainingMs - sinceUpdateMs);
  const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
  const durationSeconds = calibrationClockAnchor?.durationSeconds || 200;
  const elapsed = Math.min(
    durationSeconds,
    Math.max(0, Math.floor((calibrationClockAnchor?.elapsedSeconds || 0) + (sinceUpdateMs / 1000))),
  );
  const progress = Math.min(100, Math.max(0, ((durationSeconds * 1000 - remainingMs) / (durationSeconds * 1000)) * 100));
  const active = Boolean(latestCalibration.active) && remaining > 0;
  overlay.classList.toggle('calibration-overlay--hidden', !active);
  if (!active) return;
  setText('calibrationCountdown', `${remaining}s`);
  setText('calibrationRemaining', `${remaining}s`);
  setText('calibrationElapsed', `${elapsed}s`);
  setText('calibrationEta', formatTime(new Date(now + remainingMs)));
  setText('calibrationProgress', `${Math.round(progress)}%`);
  setText('calibrationArduino', latestHealth?.arduino_connected ? 'Connected' : 'Reconnecting');
  setText('calibrationDatabase', latestHealth?.database_status || '--');
  setWidth('calibrationBarFill', progress);
  setRingProgress('calibrationOverlay', progress);
}

function updateSystemInfo(info) {
  latestSystemInfo = info;
  const setBadge = (id, online) => {
    const el = getEl(id);
    if (!el) return;
    setText(id, online ? 'Connected' : 'Offline');
    const nextClass = `system-item__badge system-item__badge--${online ? 'online' : 'offline'}`;
    if (el.className !== nextClass) el.className = nextClass;
  };
  setText('cpuTemp', `${info.cpu_temp} C`);
  setText('cpuUsage', `${info.cpu_usage} %`);
  setText('ramUsage', `${info.ram_usage} %`);
  setText('diskUsage', `${info.disk_usage} %`);
  setBadge('wifiStatus', info.wifi_status === 'connected');
  setBadge('piStatus', info.pi_status === 'online');
  setWidth('cpuTempBar', (Number(info.cpu_temp) / 85) * 100);
  setWidth('cpuUsageBar', info.cpu_usage);
  setWidth('ramUsageBar', info.ram_usage);
  setWidth('diskUsageBar', info.disk_usage);
  updateCpuTemperatureLevel(Number(info.cpu_temp) || 0);
  updateSystemSummary(info);
  updateSystemChartFromInfo(info);
  if (latestSensorData) updateOverallStatus(latestSensorData);
}

function updateSystemSummary(info) {
  const cpuTemp = Number(info.cpu_temp) || 0;
  const cpuUsage = Number(info.cpu_usage) || 0;
  const ramUsage = Number(info.ram_usage) || 0;
  const diskUsage = Number(info.disk_usage) || 0;
  let summary = `System stable. CPU ${formatNumber(cpuUsage, 1)}%, memory ${formatNumber(ramUsage, 1)}%, storage ${formatNumber(diskUsage, 1)}%.`;
  if (cpuTemp >= 80) {
    summary = `Thermal danger: CPU temperature is ${formatNumber(cpuTemp, 1)} C. Improve airflow, reduce load, or relocate the Pi before extended operation.`;
  } else if (cpuTemp >= 75) {
    summary = `Thermal warning: CPU temperature is ${formatNumber(cpuTemp, 1)} C. Continue monitoring and improve ventilation around the Pi.`;
  } else if (cpuUsage >= 90 || ramUsage >= 90 || diskUsage >= 90) {
    summary = `System load requires attention. CPU ${formatNumber(cpuUsage, 1)}%, memory ${formatNumber(ramUsage, 1)}%, storage ${formatNumber(diskUsage, 1)}%.`;
  }
  if (info.database_status && info.database_status !== 'online') {
    summary += ' Database status is degraded; history recording may be affected.';
  }
  if (info.arduino_connected === false) {
    summary += ' Arduino is disconnected; live sensor readings may be stale.';
  }
  setText('systemSummary', summary);
}

function updateCpuTemperatureLevel(cpuTemp) {
  const item = document.querySelector('[data-system-metric="cpu_temp"]');
  if (!item) return;
  item.classList.toggle('system-item--warning', cpuTemp >= 75 && cpuTemp < 80);
  item.classList.toggle('system-item--danger-level', cpuTemp >= 80);
}

function selectSystemMetric(metric) {
  if (!SYSTEM_METRIC_LABELS[metric]) return;
  activeChartMode = 'system';
  activeSystemMetric = metric;
  focusedChartSensor = null;
  document.querySelectorAll('.chart-sensor-selector__btn[data-chart-sensor]').forEach((button) => {
    button.classList.toggle('chart-sensor-selector__btn--active', false);
  });
  document.querySelectorAll('.sensor-card[data-sensor]').forEach((card) => {
    card.classList.remove('sensor-card--chart-focus');
  });
  document.querySelectorAll('.system-item[data-system-metric]').forEach((item) => {
    item.classList.toggle('system-item--chart-focus', item.dataset.systemMetric === metric);
  });
  fetchSystemHistoricalData();
}

function setSystemChartHistory(readings) {
  clearChartArrays();
  readings.forEach((reading) => appendSystemChartPoint(reading, false));
  refreshMainChartDataset();
  getEl('chartEmptyState')?.classList.toggle('chart-empty-state--visible', readings.length === 0);
  if (envChart) envChart.update('none');
}

function appendSystemChartPoint(reading, shouldUpdate) {
  const timestamp = reading.timestamp || new Date().toISOString();
  if (chartData.timestamps.includes(timestamp)) return;
  chartData.labels.push(formatChartLabel(timestamp));
  chartData.system.push(Number(reading[activeSystemMetric]) || 0);
  chartData.timestamps.push(timestamp);
  chartData.contexts.push('system');
  chartData.statuses.push(SYSTEM_METRIC_LABELS[activeSystemMetric] || 'System');
  const maxPoints = CONFIG.chartMaxPoints[activeRange] || 1200;
  while (chartData.labels.length > maxPoints) {
    chartData.labels.shift();
    chartData.system.shift();
    chartData.timestamps.shift();
    chartData.contexts.shift();
    chartData.statuses.shift();
  }
  refreshMainChartDataset();
  if (shouldUpdate && envChart) {
    envChart.update('none');
  }
}

function updateSystemChartFromInfo(info) {
  if (activeChartMode !== 'system' || !activeSystemMetric) return;
  if (!['live', '2h'].includes(activeRange)) return;
  appendSystemChartPoint(info, true);
}

function updateLastUpdate(timestamp = null) {
  const date = timestamp ? new Date(timestamp) : new Date();
  setText('lastUpdate', formatTime(date));
}

async function fetchSensorData() {
  if (inflight.sensors) return;
  inflight.sensors = true;
  try {
    const response = await fetch(CONFIG.apiEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('API unavailable');
    recordApiSuccess();
    applySensorData(await response.json());
  } catch {
    recordApiFailure();
  } finally {
    inflight.sensors = false;
  }
}

async function fetchHistoricalData() {
  if (inflight.history) return;
  const query = buildRangeQuery();
  latestHistoryQuery = query;
  inflight.history = true;
  try {
    const response = await fetch(`${CONFIG.historyEndpoint}?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('History API unavailable');
    recordApiSuccess();
    const history = await response.json();
    if (query === latestHistoryQuery) setChartHistory(history.readings || []);
  } catch {
    recordApiFailure();
    showChartMessage('Historical data temporarily unavailable.');
  } finally {
    inflight.history = false;
  }
}

async function fetchSystemHistoricalData() {
  if (inflight.history || !activeSystemMetric) return;
  const query = buildRangeQuery();
  const metric = activeSystemMetric;
  latestHistoryQuery = `system:${metric}:${query}`;
  inflight.history = true;
  try {
    const response = await fetch(`${CONFIG.systemHistoryEndpoint}?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('System history API unavailable');
    recordApiSuccess();
    const history = await response.json();
    if (latestHistoryQuery === `system:${metric}:${query}`) {
      setSystemChartHistory(history.readings || []);
    }
  } catch {
    recordApiFailure();
    showChartMessage('System history temporarily unavailable.');
  } finally {
    inflight.history = false;
  }
}

async function fetchAnalytics() {
  if (inflight.analytics) return;
  inflight.analytics = true;
  try {
    const response = await fetch(`${CONFIG.analyticsEndpoint}?${buildRangeQuery()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Analytics unavailable');
    recordApiSuccess();
    renderAnalytics((await response.json()).analytics || {});
  } catch {
    recordApiFailure();
    renderAnalytics({});
  } finally {
    inflight.analytics = false;
  }
}

async function fetchEvents() {
  if (inflight.events) return;
  inflight.events = true;
  try {
    const response = await fetch(`${CONFIG.eventsEndpoint}?${buildRangeQuery()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Events unavailable');
    recordApiSuccess();
    latestEvents = (await response.json()).events || [];
    if (envChart) envChart.update('none');
  } catch {
    recordApiFailure();
    latestEvents = [];
  } finally {
    inflight.events = false;
  }
}

async function fetchSystemInfo() {
  if (inflight.system) return;
  inflight.system = true;
  try {
    const response = await fetch(CONFIG.systemEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('System API unavailable');
    recordApiSuccess();
    const info = await response.json();
    updateSystemInfo(info);
    updatePowerInfo(info.power);
    updateCalibrationOverlay(info.calibration);
  } catch {
    recordApiFailure();
  } finally {
    inflight.system = false;
  }
}

async function fetchPowerInfo() {
  if (inflight.power) return;
  inflight.power = true;
  try {
    const response = await fetch(CONFIG.powerEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('Power API unavailable');
    recordApiSuccess();
    updatePowerInfo(await response.json());
  } catch {
    recordApiFailure();
  } finally {
    inflight.power = false;
  }
}

async function eraseDatabaseDetails() {
  const confirmation = window.prompt('Type ERASE EDUSENSE to permanently erase stored readings, alerts, sessions, and system history.');
  if (confirmation !== 'ERASE EDUSENSE') return;
  try {
    const response = await fetch(CONFIG.databaseEraseEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: confirmation }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      window.alert(result.error || 'Database erase failed.');
      return;
    }
    clearChartArrays();
    refreshMainChartDataset();
    if (envChart) envChart.update('none');
    if (activeChartMode === 'system') fetchSystemHistoricalData();
    else fetchHistoricalData();
    fetchPowerInfo();
    window.alert('EDUSENSE database details erased.');
  } catch {
    window.alert('Database erase failed.');
  }
}

async function fetchSensorSummary(sensorId) {
  if (inflight.solo) return;
  inflight.solo = true;
  try {
    const response = await fetch(`${CONFIG.sensorSummaryEndpoint}/${encodeURIComponent(sensorId)}/summary?${buildRangeQuery()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Sensor summary unavailable');
    recordApiSuccess();
    renderSensorSummary(await response.json());
  } catch {
    recordApiFailure();
    setText('soloSuggestion', 'Sensor detail is temporarily unavailable.');
  } finally {
    inflight.solo = false;
  }
}

async function fetchHealthStatus() {
  if (inflight.health) return;
  inflight.health = true;
  try {
    const response = await fetch(CONFIG.healthEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('Health API unavailable');
    recordApiSuccess();
    const health = await response.json();
    latestHealth = health;
    updateConnectionStatus(Boolean(health.arduino_connected));
    updateCalibrationOverlay(health.calibration);
  } catch {
    recordApiFailure();
  } finally {
    inflight.health = false;
  }
}

function recordApiSuccess() {
  apiFailureCount = 0;
  updateWebConnectionStatus(true);
}

function recordApiFailure() {
  apiFailureCount += 1;
  if (apiFailureCount >= 2) updateWebConnectionStatus(false);
}

function updateWebConnectionStatus(online) {
  const dot = getEl('webConnection');
  if (dot) {
    const nextClass = `connection-dot connection-dot--${online ? 'online' : 'offline'}`;
    if (dot.className !== nextClass) dot.className = nextClass;
    const label = online ? 'Online' : 'Offline';
    const labelEl = dot.querySelector('.connection-dot__label');
    if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
  }
  const webStatus = getEl('webStatus');
  if (webStatus) {
    const nextClass = `system-item__badge system-item__badge--${online ? 'online' : 'offline'}`;
    if (webStatus.className !== nextClass) webStatus.className = nextClass;
    setText('webStatus', online ? 'Online' : 'Offline');
  }
  const overlay = getEl('offlineOverlay');
  if (overlay) {
    overlay.classList.toggle('offline-overlay--hidden', online);
  }
}

function updateConnectionStatus(arduinoConnected) {
  const dot = getEl('arduinoConnection');
  if (!dot) return;
  const nextClass = `connection-dot connection-dot--${arduinoConnected ? 'online' : 'offline'}`;
  if (dot.className !== nextClass) dot.className = nextClass;
  const label = arduinoConnected ? 'Connected' : 'Disconnected';
  const labelEl = dot.querySelector('.connection-dot__label');
  if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
}

function applySensorData(data) {
  latestSensorData = data;
  updateSensor('temp', Number(data.temp) || 0, 1);
  updateSensor('hum', Number(data.hum) || 0, 1);
  updateSensor('mq2', Number(data.mq2) || 0, 0);
  updateSensor('mq3', Number(data.mq3) || 0, 0);
  updateSensor('mq4', Number(data.mq4) || 0, 0);
  updateSensor('mq5', Number(data.mq5) || 0, 0);
  updateSensor('mq7', Number(data.mq7) || 0, 0);
  updateSensor('mq8', Number(data.mq8) || 0, 0);
  updateCalibrationOverlay(data.calibration);
  updateChartFromReading(data);
  updateOverallStatus(data);
  updateLastUpdate(data.timestamp);
}

function openSensorModal(sensorId) {
  if (!sensorId) return;
  focusChartSensor(sensorId);
  activeSoloSensor = sensorId;
  const modal = getEl('sensorModal');
  if (modal) modal.classList.remove('sensor-modal--hidden');
  if (!soloSensorChart) soloSensorChart = initSoloSensorChart();
  setText('soloSensorTitle', 'Loading...');
  setText('soloCurrent', '--');
  setText('soloMin', '--');
  setText('soloMax', '--');
  setText('soloAvg', '--');
  setText('soloSuggestion', 'Loading recent sensor history...');
  fetchSensorSummary(sensorId);
}

function focusChartSensor(sensorId) {
  selectChartSensor(['temp', 'hum', ...GAS_SENSOR_IDS].includes(sensorId) ? sensorId : 'gas');
}

function selectChartSensor(sensorId) {
  activeChartMode = 'environment';
  activeSystemMetric = null;
  focusedChartSensor = ['temp', 'hum', ...GAS_SENSOR_IDS].includes(sensorId) ? sensorId : null;
  document.querySelectorAll('.sensor-card[data-sensor]').forEach((card) => {
    card.classList.toggle('sensor-card--chart-focus', Boolean(focusedChartSensor) && card.dataset.sensor === focusedChartSensor);
  });
  document.querySelectorAll('.chart-sensor-selector__btn[data-chart-sensor]').forEach((button) => {
    const selected = focusedChartSensor || 'gas';
    button.classList.toggle('chart-sensor-selector__btn--active', button.dataset.chartSensor === selected);
  });
  document.querySelectorAll('.system-item[data-system-metric]').forEach((item) => {
    item.classList.remove('system-item--chart-focus');
  });
  if (chartData.labels.length === 0) fetchHistoricalData();
  refreshMainChartDataset();
  if (envChart) envChart.update('none');
}

function closeSensorModal() {
  activeSoloSensor = null;
  getEl('sensorModal')?.classList.add('sensor-modal--hidden');
}

function renderSensorSummary(summary) {
  const unit = summary.sensor === 'temperature' ? ' C' : summary.sensor === 'humidity' ? ' %' : ' ppm est.';
  const status = String(summary.system_status || 'SAFE').toUpperCase();
  setText('soloSensorTitle', summary.label || summary.sensor?.toUpperCase() || 'Sensor');
  setText('soloCurrent', formatMetric(summary.live_current ?? summary.current?.value, unit));
  setText('soloMin', formatMetric(summary.min_value, unit));
  setText('soloMax', formatMetric(summary.max_value, unit));
  setText('soloAvg', formatMetric(summary.avg_value, unit));
  setText('soloSuggestion', summary.ai_suggestion || 'Sensor is stable in the selected window.');
  const badge = getEl('soloSensorStatus');
  if (badge) {
    setText('soloSensorStatus', status);
    const nextClass = `status-badge status-badge--${status.toLowerCase()}`;
    if (badge.className !== nextClass) badge.className = nextClass;
  }
  if (!soloSensorChart) soloSensorChart = initSoloSensorChart();
  if (soloSensorChart) {
    soloSensorChart.data.labels = (summary.readings || []).map((reading) => formatChartLabel(reading.timestamp));
    soloSensorChart.data.datasets[0].label = summary.label || 'Sensor Reading';
    soloSensorChart.data.datasets[0].data = (summary.readings || []).map((reading) => Number(reading.value) || 0);
    soloSensorChart.update('none');
  }
}

function updatePowerInfo(power) {
  if (!power) return;
  const previous = power.previous_session || null;
  const lastReading = power.last_stored_reading || null;
  setText('powerLastRecord', lastReading?.timestamp ? formatDateTime(new Date(lastReading.timestamp)) : 'No readings yet');
  setText('powerStoredReadings', String(power.stored_reading_count ?? '--'));
  setText('powerShutdownType', previous?.shutdown_type ? previous.shutdown_type.replaceAll('_', ' ') : 'No previous session');
}

function renderAnalytics(analytics) {
  setText('analyticsAvgTemp', formatMetric(analytics.avg_temperature, ' C'));
  setText('analyticsMaxTemp', formatMetric(analytics.max_temperature, ' C'));
  setText('analyticsAvgHum', formatMetric(analytics.avg_humidity, ' %'));
  setText('analyticsWarnings', String(analytics.warning_events ?? analytics.warning_samples ?? '--'));
  setText('analyticsDangers', String(analytics.danger_events ?? analytics.danger_samples ?? '--'));
  setText('analyticsCoverage', analytics.data_coverage_pct !== undefined ? `${analytics.data_coverage_pct}%` : '--');
}

function showChartMessage(message) {
  const empty = getEl('chartEmptyState');
  if (!empty) return;
  setText('chartEmptyState', message);
  empty.classList.add('chart-empty-state--visible');
}

function nearestTimestampIndex(timestamp) {
  if (!timestamp) return -1;
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target)) return -1;
  let bestIndex = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < chartData.timestamps.length; i++) {
    const delta = Math.abs(Date.parse(chartData.timestamps[i]) - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function remainingFromCalibration(calibration) {
  if (calibration === latestCalibration && calibrationClockAnchor && calibrationClockAnchor.remainingMs !== null) {
    const elapsedSinceUpdate = Math.max(0, Date.now() - calibrationClockAnchor.receivedAt);
    return Math.max(0, Math.ceil((calibrationClockAnchor.remainingMs - elapsedSinceUpdate) / 1000));
  }
  const backendRemaining = Number(calibration.remaining_seconds);
  if (Number.isFinite(backendRemaining)) return Math.max(0, Math.ceil(backendRemaining));
  const eta = Date.parse(calibration.estimated_completion_time);
  if (!Number.isFinite(eta)) return 0;
  return Math.max(0, Math.ceil((eta - Date.now()) / 1000));
}

function secondsToMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 1000 : Date.now();
}

function getEl(id) {
  if (!domCache.has(id)) domCache.set(id, document.getElementById(id));
  return domCache.get(id);
}

function setText(id, value) {
  const el = getEl(id);
  const text = String(value);
  if (el && valueCache.get(id) !== text) {
    el.textContent = text;
    valueCache.set(id, text);
  }
}

function setWidth(id, pct) {
  const el = getEl(id);
  if (!el) return;
  const value = `${Math.min(Math.max(Number(pct) || 0, 0), 100).toFixed(2)}%`;
  if (valueCache.get(`${id}:width`) !== value) {
    el.style.width = value;
    valueCache.set(`${id}:width`, value);
  }
}

function setRingProgress(containerId, progress) {
  const container = getEl(containerId);
  const ring = container ? container.querySelector('.progress-ring') : null;
  if (!ring) return;
  const value = Math.min(Math.max(Number(progress) || 0, 0), 100).toFixed(2);
  if (valueCache.get(`${containerId}:ring`) !== value) {
    ring.style.setProperty('--progress', value);
    valueCache.set(`${containerId}:ring`, value);
  }
}

function hideElement(id, className) {
  const el = getEl(id);
  if (el) el.classList.add(className);
}

function formatTime(date) {
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(date) {
  return date.toLocaleString('en-IN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMetric(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const number = Number(value);
  const decimals = Number.isInteger(number) ? 0 : 1;
  return `${number.toFixed(decimals)}${unit}`;
}

function formatNumber(value, decimals) {
  const number = Number(value) || 0;
  return decimals > 0 ? number.toFixed(decimals) : String(Math.round(number));
}

function toDateInputValue(date) {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 10);
}

function toDateTimeLocalValue(date) {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function formatSelectedDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

window.EDUSENSE_EXPORT_CONTEXT = {
  getChartImage() {
    return envChart ? envChart.toBase64Image('image/png', 1) : '';
  },
  getPointCount() {
    return chartData.labels.length;
  },
  getSelectedSensor() {
    return focusedChartSensor || 'gas';
  },
  getActiveRange() {
    return activeRange;
  },
  getSelectedDate() {
    return selectedDate;
  },
  getRangeQuery() {
    return buildRangeQuery();
  },
};
