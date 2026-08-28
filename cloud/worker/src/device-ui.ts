import dashboardHtml from './device-dashboard.txt';
import dashboardCss from './device-style.txt';

export function renderDeviceDashboard(nonce: string, deviceId: string): string {
  const script = cloudDashboardScript(deviceId);
  return dashboardHtml
    .replace(/\s*<link[^>]+(?:fonts\.googleapis|fonts\.gstatic|url_for)[^>]*>/g, '')
    .replace(/\s*<script[^>]+src="[^"]*"[^>]*><\/script>/g, '')
    .replace('</head>', `<style nonce="${nonce}">${dashboardCss}</style></head>`)
    .replace('</body>', `<script nonce="${nonce}">${script}</script></body>`)
    .replace('EDUSENSE AI | Classroom Air Quality Monitor', 'EDUSENSE AI | School Portal');
}

function cloudDashboardScript(deviceId: string): string {
  return `
(() => {
  const DEVICE_ID = ${JSON.stringify(deviceId)};
  const sensors = ['mq2','mq3','mq4','mq5','mq7','mq8'];
  const names = {temp:'Temperature',hum:'Humidity',mq2:'MQ-2 Smoke',mq3:'MQ-3 Alcohol',mq4:'MQ-4 Methane',mq5:'MQ-5 LPG',mq7:'MQ-7 Carbon Monoxide',mq8:'MQ-8 Hydrogen'};
  const units = {temp:' °C',hum:'%'};
  let range = 'live', metric = 'gas', latest = null, history = [], selectedSolo = null, historyUnit = 'ADC', baseline = {}, baselineUnit = 'ADC', baselineSamples = 0, sensorStates = {};
  const $ = id => document.getElementById(id);
  const num = (v, digits = 0) => Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '--';
  const gasUnit = unit => unit === 'ESTIMATED_PPM' ? ' ppm est.' : ' ADC';
  const api = async path => { const r = await fetch(path, {credentials:'same-origin'}); const d = await r.json().catch(()=>({})); if (!r.ok) throw new Error(d.error || 'Unable to load cloud data'); return d; };
  const statusText = s => ({SAFE:'Air conditions are within the classroom baseline. Continue normal ventilation and routine checks.',ELEVATED:'Conditions are slightly above the classroom baseline. Open doors or windows where practical and keep watching.',WARNING:'Conditions have remained above the classroom baseline. Inform a teacher and improve ventilation.',DANGER:'A sustained hazardous condition was detected. Follow the school safety procedure and move people away if needed.',CALIBRATING:'The gas sensors are warming up. Readings are saved, but safety decisions are paused until the baseline is ready.',OFFLINE:'The classroom device is offline. The last saved reading is still available.'}[s] || 'Classroom monitoring is active.');
  function clock(){ const n=new Date(); $('liveClock').textContent=n.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}); $('liveDate').textContent=n.toLocaleDateString([], {weekday:'long',year:'numeric',month:'long',day:'numeric'}); }
  function connection(id, online, label){ const el=$(id); if(!el)return; el.classList.toggle('connection-dot--online',online); el.classList.toggle('connection-dot--offline',!online); const t=el.querySelector('.connection-dot__label'); if(t)t.textContent=label; }
  function applyLatest(device){
    latest=device.latest||{}; const age=latest.captured_at ? Date.now()/1000-Number(latest.captured_at) : Infinity; const online=age<30;
    const status=online ? (latest.ai_status||'CALIBRATING') : 'OFFLINE';
    $('status').textContent=status; $('status').className='status-badge status-badge--'+status.toLowerCase();
    connection('piConnection',online,online?'Connected':'Offline'); connection('webConnection',true,'Online'); connection('arduinoConnection',online&&!!latest.arduino_connected,online&&latest.arduino_connected?'Connected':'Disconnected');
    $('lastUpdate').textContent=latest.captured_at?new Date(latest.captured_at*1000).toLocaleTimeString():'--:--:--';
    [['temp','temperature',1],['hum','humidity',1],...sensors.map(k=>[k,k,0])].forEach(([id,key,d])=>{ if($(id))$(id).textContent=num(latest[key],d); });
    document.querySelectorAll('.sensor-card[data-sensor^="mq"] .sensor-card__unit').forEach(el=>el.textContent=gasUnit(latest.measurement_unit).trim());
    document.querySelectorAll('.sensor-card').forEach(card=>{ const key=card.dataset.sensor, dot=card.querySelector('.status-indicator'), text=card.querySelector('.sensor-card__status-text'); if(key==='temp'||key==='hum'){if(dot)dot.className='status-indicator status-indicator--safe';if(text)text.textContent=online?'Normal':'Last stored';return} if(dot)dot.className='status-indicator status-indicator--safe';if(text)text.textContent=status==='CALIBRATING'?'Building baseline':online?'Analyzing':'Last stored'; });
    $('aiText').textContent=statusText(status); $('cpuTemp').textContent=num(latest.pi_cpu_temp,1)+' °C'; $('cpuUsage').textContent=num(latest.cpu_usage,1)+' %'; $('ramUsage').textContent=num(latest.ram_usage,1)+' %'; $('diskUsage').textContent=num(latest.disk_usage,1)+' %';
    [['cpuTempBar',latest.pi_cpu_temp,85],['cpuUsageBar',latest.cpu_usage,100],['ramUsageBar',latest.ram_usage,100],['diskUsageBar',latest.disk_usage,100]].forEach(([id,v,max])=>{if($(id))$(id).style.width=Math.max(0,Math.min(100,Number(v||0)/max*100))+'%'});
    $('systemSummary').textContent=online?'Current readings are being saved from the classroom device. Device health, connections, and history are available here.':'Showing the last saved classroom reading. Updates resume automatically when the Raspberry Pi reconnects.';
    $('wifiStatus').textContent=online?'Connected':'Offline'; $('piStatus').textContent=online?'Online':'Offline'; $('webStatus').textContent='Online';
    $('powerLastRecord').textContent=latest.captured_at?new Date(latest.captured_at*1000).toLocaleString():'No record'; $('powerShutdownType').textContent=online?'Device running':'Power or network offline';
    $('offlineOverlay').classList.add('offline-overlay--hidden'); $('calibrationOverlay').classList.toggle('calibration-overlay--hidden',status!=='CALIBRATING');
  }
  function valuesFor(row,key){ if(key==='temp')return Number(row.temperature); if(key==='hum')return Number(row.humidity); if(key==='gas')return sensors.reduce((a,k)=>a+Number(row[k]||0),0)/sensors.length; return Number(row[key]); }
  function draw(canvas, points, color='#00e5ff'){
    const box=canvas.parentElement.getBoundingClientRect(), ratio=Math.min(devicePixelRatio||1,2), w=Math.max(300,box.width), h=Math.max(220,box.height); canvas.width=w*ratio; canvas.height=h*ratio; canvas.style.width=w+'px'; canvas.style.height=h+'px'; const c=canvas.getContext('2d'); c.scale(ratio,ratio); c.clearRect(0,0,w,h); c.strokeStyle='rgba(120,160,190,.16)'; c.lineWidth=1; for(let y=1;y<5;y++){c.beginPath();c.moveTo(36,y*h/5);c.lineTo(w-12,y*h/5);c.stroke()} if(!points.length)return; const vals=points.map(p=>p.v),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(.1,max-min); c.strokeStyle=color;c.lineWidth=2;c.beginPath();points.forEach((p,i)=>{const x=36+i/Math.max(1,points.length-1)*(w-50),y=h-24-(p.v-min)/span*(h-48);i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();c.fillStyle='#91a0b4';c.font='11px Poppins';c.fillText(max.toFixed(1),3,17);c.fillText(min.toFixed(1),3,h-17);
  }
  async function loadHistory(){
    try{ const d=await api('/api/devices/'+encodeURIComponent(DEVICE_ID)+'/history?range='+range); history=d.readings||[]; historyUnit=d.measurementUnit||'ADC'; baseline=d.baseline||{};baselineUnit=d.baselineUnit||'ADC';baselineSamples=Number(d.baselineSamples||0);sensorStates=d.sensorStates||{}; document.querySelectorAll('.sensor-card[data-sensor^="mq"]').forEach(card=>{const key=card.dataset.sensor,state=sensorStates[key]||'BASELINING',dot=card.querySelector('.status-indicator'),label=card.querySelector('.sensor-card__status-text'),base=Number(baseline[key]);if(dot)dot.className='status-indicator status-indicator--'+(state==='BASELINING'?'safe':state.toLowerCase());if(label)label.textContent=(state==='BASELINING'?'Building baseline':state)+(Number.isFinite(base)?' · baseline '+base.toFixed(1)+' '+baselineUnit:'')}); $('powerStoredReadings').textContent=history.length.toLocaleString(); const vals=history.map(r=>valuesFor(r,metric)).filter(Number.isFinite), points=history.map(r=>({v:valuesFor(r,metric)})).filter(p=>Number.isFinite(p.v)); draw($('envChart'),points); $('chartEmptyState').style.display=points.length?'none':'grid'; const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null; $('chartMetricLabel').textContent=(names[metric]||'Gas Average')+(metric==='temp'||metric==='hum'?'':gasUnit(historyUnit)); $('chartMetricSamples').textContent=vals.length+' samples · baseline '+baselineSamples+'/200'; $('chartMetricAvg').textContent=avg===null?'--':avg.toFixed(1); $('chartMetricMin').textContent=vals.length?Math.min(...vals).toFixed(1):'--'; $('chartMetricMax').textContent=vals.length?Math.max(...vals).toFixed(1):'--'; const temps=history.map(r=>Number(r.temperature)).filter(Number.isFinite), hums=history.map(r=>Number(r.humidity)).filter(Number.isFinite); $('analyticsAvgTemp').textContent=temps.length?(temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1)+' °C':'--'; $('analyticsMaxTemp').textContent=temps.length?Math.max(...temps).toFixed(1)+' °C':'--'; $('analyticsAvgHum').textContent=hums.length?(hums.reduce((a,b)=>a+b,0)/hums.length).toFixed(1)+'%':'--'; $('analyticsWarnings').textContent=history.filter(r=>r.ai_status==='WARNING').length; $('analyticsDangers').textContent=history.filter(r=>r.ai_status==='DANGER').length; $('analyticsCoverage').textContent=history.length?Math.min(100,Math.round(history.length/Math.max(1,range==='live'?120:120)*100))+'%':'0%'; if(selectedSolo)renderSolo(); }catch(e){$('chartEmptyState').textContent=e.message;$('chartEmptyState').style.display='grid';}
  }
  function renderSolo(){ const key=selectedSolo,vals=history.map(r=>valuesFor(r,key)).filter(Number.isFinite),current=Number(latest?.[key]),unit=gasUnit(latest?.measurement_unit); $('soloSensorTitle').textContent=names[key]; $('soloCurrent').textContent=num(current,1)+unit; $('soloMin').textContent=vals.length?Math.min(...vals).toFixed(1)+gasUnit(historyUnit):'--'; $('soloMax').textContent=vals.length?Math.max(...vals).toFixed(1)+gasUnit(historyUnit):'--'; const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null; $('soloAvg').textContent=avg===null?'--':avg.toFixed(1)+gasUnit(historyUnit); $('soloSensorStatus').textContent=latest?.ai_status||'OFFLINE'; $('soloSuggestion').textContent=avg===null?'Waiting for enough saved readings.':Math.abs(current-avg)<Math.max(1,avg*.05)?names[key]+' is close to its recent average. Continue normal classroom ventilation.':current>avg?names[key]+' is above its recent average. Improve ventilation and check the overall classroom status.':names[key]+' is moving back toward its recent baseline.'; draw($('soloSensorChart'),history.map(r=>({v:valuesFor(r,key)})).filter(p=>Number.isFinite(p.v)),'#00e5ff'); }
  function download(name, blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
  function exportSelected(){
    if(!history.length){ alert('No readings are available for the selected range.'); return; }
    const mode=(prompt('Export the selected '+range.toUpperCase()+' range as CSV or PNG?','CSV')||'').trim().toUpperCase();
    if(mode==='PNG'){ $('envChart').toBlob(blob=>blob&&download('edusense-'+metric+'-'+range+'.png',blob),'image/png'); return; }
    if(mode!=='CSV') return;
    const fields=['temperature','humidity','mq2','mq3','mq4','mq5','mq7','mq8','overall_aqi'];
    const rows=[['timestamp_iso','measurement_unit',...fields].join(',')].concat(history.map(r=>[new Date(Number(r.captured_at)*1000).toISOString(),r.measurement_unit||'ADC',...fields.map(k=>r[k]??'')].join(',')));
    download('edusense-'+range+'.csv',new Blob([rows.join('\\n')],{type:'text/csv;charset=utf-8'}));
  }
  async function refresh(){ try{const d=await api('/api/devices');const device=(d.devices||[]).find(x=>x.id===DEVICE_ID);if(!device)throw new Error('Device access denied');applyLatest(device);}catch(e){location.href='/portal';} }
  document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{range=b.dataset.range;document.querySelectorAll('[data-range]').forEach(x=>x.classList.toggle('history-controls__btn--active',x===b));loadHistory()}));
  document.querySelectorAll('[data-chart-sensor]').forEach(b=>b.addEventListener('click',()=>{metric=b.dataset.chartSensor;document.querySelectorAll('[data-chart-sensor]').forEach(x=>x.classList.toggle('chart-sensor-selector__btn--active',x===b));loadHistory()}));
  document.querySelectorAll('.sensor-card[data-sensor^="mq"]').forEach(c=>c.addEventListener('click',()=>{selectedSolo=c.dataset.sensor;$('sensorModal').classList.remove('sensor-modal--hidden');renderSolo()})); $('sensorModalClose').onclick=()=>$('sensorModal').classList.add('sensor-modal--hidden'); $('eraseDatabaseButton').style.display='none';
  document.querySelectorAll('#calendarButton,#customRangeButton').forEach(b=>b.style.display='none'); $('exportButton').onclick=exportSelected;
  clock();setInterval(clock,1000);$('bootScreen').style.display='none';refresh().then(loadHistory);setInterval(refresh,5000);setInterval(loadHistory,15000);
})();`;
}
