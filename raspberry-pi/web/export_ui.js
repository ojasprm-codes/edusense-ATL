/**
 * EDUSENSE AI V7 export UI module.
 * Keeps export dialog and export actions separate from the main dashboard file.
 */

'use strict';

const EXPORT_CONFIG = {
  csvEndpoint: '/api/export.csv',
  pngEndpoint: '/api/export.png',
};

document.addEventListener('DOMContentLoaded', () => {
  injectExportModal();
  document.getElementById('exportButton')?.addEventListener('click', openExportModal);
  document.getElementById('exportModalClose')?.addEventListener('click', closeExportModal);
  document.getElementById('exportRunButton')?.addEventListener('click', runExport);
  document.getElementById('exportModal')?.addEventListener('click', (event) => {
    if (event.target === document.getElementById('exportModal')) closeExportModal();
  });
});

function injectExportModal() {
  if (document.getElementById('exportModal')) return;
  const section = document.createElement('section');
  section.id = 'exportModal';
  section.className = 'sensor-modal sensor-modal--hidden';
  section.setAttribute('aria-live', 'polite');
  section.setAttribute('aria-label', 'Export readings');
  section.innerHTML = `
    <div class="sensor-modal__card export-modal__card glass-panel">
      <button id="exportModalClose" class="sensor-modal__close" type="button" aria-label="Close export dialog">&times;</button>
      <div class="sensor-modal__header">
        <div>
          <span class="sensor-modal__eyebrow">EXPORT DATA</span>
          <h2>EDUSENSE Readings</h2>
        </div>
      </div>
      <div class="export-modal__grid">
        <label>
          <span>Format</span>
          <select id="exportFormat" class="date-history-panel__select">
            <option value="csv">CSV</option>
            <option value="png">PNG</option>
          </select>
        </label>
        <label>
          <span>From</span>
          <input id="exportStartInput" class="date-history-panel__input" type="datetime-local">
        </label>
        <label>
          <span>To</span>
          <input id="exportEndInput" class="date-history-panel__input" type="datetime-local">
        </label>
        <label>
          <span>Rows</span>
          <input id="exportLimitInput" class="date-history-panel__input" type="number" min="5" max="250000" step="100" value="5000">
        </label>
      </div>
      <div class="export-modal__actions">
        <button id="exportRunButton" class="history-controls__btn" type="button">EXPORT</button>
        <strong id="exportStatus" class="export-modal__status">Choose range and format.</strong>
      </div>
    </div>
  `;
  document.body.appendChild(section);
}

function openExportModal() {
  document.getElementById('exportModal')?.classList.remove('sensor-modal--hidden');
  setExportDefaults();
  setExportStatus('Choose range and format.');
}

function closeExportModal() {
  document.getElementById('exportModal')?.classList.add('sensor-modal--hidden');
}

function setExportDefaults() {
  const exportStart = document.getElementById('exportStartInput');
  const exportEnd = document.getElementById('exportEndInput');
  const context = window.EDUSENSE_EXPORT_CONTEXT;
  const query = new URLSearchParams(context?.getRangeQuery ? context.getRangeQuery() : 'range=live');
  const now = new Date();
  const rangeDurations = { live: 30, '2h': 120, '5h': 300, '1d': 1440, '20d': 28800, '2m': 89280 };
  const range = query.get('range') || 'live';
  let start = query.get('start') ? new Date(query.get('start')) : null;
  let end = query.get('end') ? new Date(query.get('end')) : now;
  if (!start && query.get('date')) {
    start = new Date(`${query.get('date')}T00:00:00`);
    end = new Date(start.getTime() + (Number(query.get('hours') || 24) * 60 * 60 * 1000));
  }
  if (!start) start = new Date(now.getTime() - ((rangeDurations[range] || 30) * 60 * 1000));
  if (exportStart) exportStart.value = toDateTimeLocalValue(start);
  if (exportEnd) exportEnd.value = toDateTimeLocalValue(end);
}

function buildExportQuery() {
  const params = new URLSearchParams();
  const start = document.getElementById('exportStartInput')?.value;
  const end = document.getElementById('exportEndInput')?.value;
  const limit = document.getElementById('exportLimitInput')?.value || '5000';
  const context = window.EDUSENSE_EXPORT_CONTEXT;
  params.set('range', 'custom');
  if (start) params.set('start', new Date(start).toISOString());
  if (end) params.set('end', new Date(end).toISOString());
  params.set('limit', limit);
  params.set('sensor', context?.getSelectedSensor ? context.getSelectedSensor() : 'gas');
  return params.toString();
}

async function runExport() {
  const format = document.getElementById('exportFormat')?.value || 'csv';
  if (format === 'png') {
    await exportPng();
    return;
  }
  await exportCsv();
}

async function exportCsv() {
  setExportStatus('Preparing CSV...');
  try {
    const response = await fetch(`${EXPORT_CONFIG.csvEndpoint}?${buildExportQuery()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('CSV export failed');
    const blob = await response.blob();
    const savedPath = response.headers.get('X-EDUSENSE-Saved-Path');
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename=([^;]+)/);
    downloadBlob(blob, match ? match[1].replaceAll('"', '') : `edusense-${Date.now()}.csv`);
    setExportStatus(savedPath ? `Saved ${savedPath}` : 'CSV downloaded.');
  } catch {
    setExportStatus('CSV export failed.');
  }
}

async function exportPng() {
  const context = window.EDUSENSE_EXPORT_CONTEXT;
  const image = context?.getChartImage ? context.getChartImage() : '';
  const points = context?.getPointCount ? context.getPointCount() : 0;
  if (!image) {
    setExportStatus('No chart available.');
    return;
  }
  setExportStatus('Preparing PNG...');
  downloadDataUrl(image, `edusense-${context?.getActiveRange?.() || 'chart'}-${context?.getSelectedDate?.() || Date.now()}.png`);
  if (points < 5) {
    setExportStatus('PNG downloaded. Need 5+ points to save folder copy.');
    return;
  }
  try {
    const response = await fetch(EXPORT_CONFIG.pngEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image,
        points,
        query: buildExportQuery(),
        sensor: context?.getSelectedSensor ? context.getSelectedSensor() : 'gas',
      }),
    });
    const data = await response.json();
    setExportStatus(data.saved_path ? `Saved ${data.saved_path}` : 'PNG exported.');
  } catch {
    setExportStatus('PNG downloaded. Folder save unavailable.');
  }
}

function setExportStatus(text) {
  const status = document.getElementById('exportStatus');
  if (status && status.textContent !== text) status.textContent = text;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  URL.revokeObjectURL(url);
}

function downloadDataUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

function toDateTimeLocalValue(date) {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}
