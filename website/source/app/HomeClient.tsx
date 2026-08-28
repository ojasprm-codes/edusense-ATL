"use client";

import {
  ArrowRight,
  BellRing,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Download,
  GraduationCap,
  HeartPulse,
  LifeBuoy,
  LockKeyhole,
  Menu,
  Microchip,
  Network,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

const navItems = [
  ["Product", "#product"],
  ["For Schools", "#schools"],
  ["Technology", "#technology"],
  ["Pilot", "#pilot"],
  ["Demo", "#demo"],
  ["Support", "#support"],
] as const;

const cloudPortalUrl = "https://edusense-cloud.ojasprm.workers.dev/portal";

const sensors = {
  MQ2: { label: "Smoke / LPG", value: 284, avg: 269, low: 241, high: 302, change: "+5.6%", advice: "Stable variation. Continue normal classroom operation.", tone: "safe" },
  MQ3: { label: "Alcohol vapour", value: 174, avg: 181, low: 162, high: 196, change: "-3.9%", advice: "No sustained anomaly detected in the current sample window.", tone: "safe" },
  MQ4: { label: "Methane", value: 219, avg: 211, low: 197, high: 231, change: "+3.8%", advice: "Reading remains within the adaptive classroom baseline.", tone: "safe" },
  MQ5: { label: "LPG / natural gas", value: 248, avg: 229, low: 208, high: 256, change: "+8.3%", advice: "Minor rise detected. Observe ventilation over the next few minutes.", tone: "elevated" },
  MQ7: { label: "Carbon monoxide", value: 191, avg: 185, low: 177, high: 202, change: "+3.2%", advice: "Carbon monoxide pattern is stable and below alert criteria.", tone: "safe" },
  MQ8: { label: "Hydrogen", value: 207, avg: 203, low: 189, high: 218, change: "+2.0%", advice: "No correlated gas increase. Conditions remain stable.", tone: "safe" },
} as const;

const chartSets: Record<string, number[]> = {
  LIVE: [38, 42, 40, 46, 44, 49, 47, 54, 52, 58, 55, 61, 57, 60, 58, 63, 59, 62],
  "2H": [31, 35, 34, 39, 42, 40, 44, 48, 46, 51, 49, 53, 56, 52, 55, 58, 57, 60],
  "1D": [48, 43, 40, 37, 35, 39, 45, 52, 58, 61, 57, 54, 50, 47, 44, 46, 49, 51],
  "20D": [33, 36, 39, 42, 38, 41, 45, 48, 51, 49, 53, 55, 52, 57, 60, 58, 61, 59],
};

const audienceViews = {
  teachers: {
    label: "Teachers",
    icon: GraduationCap,
    title: "A calm answer during a busy lesson.",
    copy: "See one clear classroom status, practical ventilation guidance, and the latest environmental readings without interpreting technical sensor data.",
    points: ["Immediate room status", "Plain-language guidance", "No raw threshold decisions"],
  },
  leaders: {
    label: "School leaders",
    icon: Building2,
    title: "Evidence for healthier school decisions.",
    copy: "Review assigned classrooms, compare recurring patterns, and use persistent history to support maintenance, ventilation and pilot planning.",
    points: ["Multi-classroom overview", "Historical trend review", "CSV and visual reports"],
  },
  families: {
    label: "Families",
    icon: Users,
    title: "The right view, without unnecessary access.",
    copy: "Invited parents can see the selected classroom assigned to them, while staff retain the broader school view needed for operations.",
    points: ["Selected-classroom access", "Secure Google sign-in", "Clear recent status"],
  },
} as const;

const systemLayers = {
  arduino: {
    label: "Arduino",
    icon: Microchip,
    kicker: "Reliable acquisition layer",
    title: "One complete sensor packet every second.",
    copy: "The Arduino reads the DHT22 and six MQ channels, then sends the complete packet over USB serial. It never decides whether a classroom is safe.",
    points: ["Stable sensor timing", "Simple serial packet", "No frontend decisions"],
  },
  raspberryPi: {
    label: "Raspberry Pi",
    icon: Database,
    kicker: "Local decision and history layer",
    title: "The classroom keeps thinking when the internet stops.",
    copy: "The Pi performs mandatory calibration, filters spikes, evaluates sustained trends, stores SQLite history and controls the Arduino status outputs.",
    points: ["200-second calibration", "Persistent SQLite history", "LED and buzzer control"],
  },
  cloud: {
    label: "Cloud portal",
    icon: Cloud,
    kicker: "Secure access layer",
    title: "Useful visibility beyond the classroom network.",
    copy: "Authorized users receive the view appropriate to their role while private device controls and local Raspberry Pi addresses remain protected.",
    points: ["Role-aware access", "Remote classroom status", "Private device boundary"],
  },
} as const;

export function HomeClient() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sensor, setSensor] = useState<keyof typeof sensors>("MQ2");
  const [range, setRange] = useState("LIVE");
  const [audience, setAudience] = useState<keyof typeof audienceViews>("teachers");
  const [systemLayer, setSystemLayer] = useState<keyof typeof systemLayers>("raspberryPi");
  const [formStatus, setFormStatus] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const current = sensors[sensor];
  const chartData = useMemo(() => chartSets[range], [range]);
  const activeAudience = audienceViews[audience];
  const AudienceIcon = activeAudience.icon;
  const activeLayer = systemLayers[systemLayer];
  const LayerIcon = activeLayer.icon;

  async function submitInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFormStatus("");
    setFormError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = (await response.json()) as { error?: string; reference?: string };
      if (!response.ok) throw new Error(result.error || "Your message could not be recorded.");
      setFormStatus(`Message received. Your support reference is ${result.reference}.`);
      form.reset();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Your message could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand brand-wordmark" href="#top" aria-label="EDUSENSE AI home"><img src="/edusense-brand-logo.png" alt="EDUSENSE AI" /></a>
        <nav className={menuOpen ? "nav-links open" : "nav-links"} aria-label="Primary navigation">
          {navItems.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
        </nav>
        <a className="button button-small header-cta" href={cloudPortalUrl} target="_blank" rel="noreferrer">Have a device? Use now <ArrowRight size={16} /></a>
        <button className="icon-button menu-button" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen}>
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-content">
          <p className="eyebrow hero-eyebrow"><span className="eyebrow-logo"><img src="/edusense-logo.svg" alt="" aria-hidden="true" /></span><span>Built for real classrooms</span></p>
          <h1><span>EDUSENSE AI</span><strong><i>See the room.</i><b>Protect the learning.</b></strong></h1>
          <p className="hero-lead">A brighter way to understand the classroom environment.</p>
          <p className="hero-copy">A classroom monitor that records temperature, humidity and gas-sensor changes every second, explains sustained changes clearly, and keeps working even when the internet does not.</p>
          <div className="hero-actions">
            <a className="button" href="#pilot">Start a school pilot <ArrowRight size={18} /></a>
            <a className="text-link" href="#demo">Explore the dashboard <ChevronRight size={18} /></a>
            <a className="text-link" href={cloudPortalUrl} target="_blank" rel="noreferrer">Open your school portal <ChevronRight size={18} /></a>
          </div>
          <div className="trust-row" aria-label="Product qualities">
            <span><ShieldCheck size={17} /> Local-first</span>
            <span><LockKeyhole size={17} /> Private by design</span>
            <span><Zap size={17} /> Real-time response</span>
          </div>
        </div>

        <a className="scroll-cue" href="#product" aria-label="Scroll to product overview"><ChevronDown /></a>
      </section>

      <section className="signal-band" aria-label="EDUSENSE outcomes">
        <div><strong>1 sec</strong><span>Sensor packet interval</span></div>
        <div><strong>6</strong><span>Gas channels monitored</span></div>
        <div><strong>4</strong><span>Clear safety levels</span></div>
        <div><strong>Local</strong><span>Decision processing</span></div>
      </section>

      <section className="section product-section" id="product">
        <div className="section-heading split-heading">
          <div><p className="eyebrow">The product</p><h2>From invisible changes to clear action.</h2></div>
          <p>EDUSENSE continuously observes classroom conditions, learns a stable local baseline, and helps staff distinguish normal variation from meaningful environmental deterioration.</p>
        </div>
        <div className="feature-grid">
          <article><span className="feature-icon cyan"><Radio /></span><h3>Continuous sensing</h3><p>Temperature, humidity, smoke and gas-sensitive channels are sampled every second.</p><a href="#technology">See the sensor system <ChevronRight size={16} /></a></article>
          <article><span className="feature-icon green"><Sparkles /></span><h3>Baseline-aware checks</h3><p>Rolling baselines, trends, correlation and consecutive readings reduce false alarms without ignoring real risk.</p><a href="#technology">Understand the logic <ChevronRight size={16} /></a></article>
          <article><span className="feature-icon amber"><BellRing /></span><h3>Actionable response</h3><p>Teachers see simple status guidance while local lights and alarms respond only to backend decisions.</p><a href="#schools">Explore school use <ChevronRight size={16} /></a></article>
          <article><span className="feature-icon blue"><Database /></span><h3>Evidence over time</h3><p>Persistent history helps schools review patterns across lessons, days and longer reporting periods.</p><a href="#demo">View sample analytics <ChevronRight size={16} /></a></article>
        </div>
      </section>

      <section className="section school-section" id="schools">
        <div className="school-copy">
          <p className="eyebrow">Built for schools</p>
          <h2>Useful in the lesson. Valuable beyond it.</h2>
          <p>EDUSENSE gives each audience the right level of clarity, from an immediate classroom status to evidence that supports facilities planning.</p>
          <div className="role-explorer">
            <div className="role-tabs" role="tablist" aria-label="Choose an EDUSENSE audience view">
              {(Object.keys(audienceViews) as Array<keyof typeof audienceViews>).map((key) => (
                <button key={key} type="button" role="tab" aria-selected={audience === key} className={audience === key ? "active" : ""} onClick={() => setAudience(key)}>{audienceViews[key].label}</button>
              ))}
            </div>
            <div className="role-panel" role="tabpanel">
              <AudienceIcon />
              <div><h3>{activeAudience.title}</h3><p>{activeAudience.copy}</p><ul>{activeAudience.points.map((point) => <li key={point}><Check size={15} />{point}</li>)}</ul></div>
            </div>
          </div>
        </div>
        <div className="classroom-map" aria-label="Sample school coverage view">
          <div className="map-head"><span>Campus overview</span><small>Sample data</small></div>
          <div className="room-grid">
            <div className="room safe"><span>7A</span><b>SAFE</b><small>24.1°C · 47%</small></div>
            <div className="room safe"><span>7B</span><b>SAFE</b><small>24.8°C · 49%</small></div>
            <div className="room elevated"><span>8A</span><b>ELEVATED</b><small>Ventilation advised</small></div>
            <div className="room safe"><span>Science</span><b>SAFE</b><small>23.9°C · 45%</small></div>
            <div className="room offline"><span>Lab 2</span><b>OFFLINE</b><small>Device check due</small></div>
            <div className="room safe"><span>Library</span><b>SAFE</b><small>23.5°C · 46%</small></div>
          </div>
          <div className="map-footer"><span><i className="dot-safe" /> 4 safe</span><span><i className="dot-elevated" /> 1 elevated</span><span><i className="dot-offline" /> 1 offline</span></div>
        </div>
      </section>

      <section className="section process-section" id="technology">
        <div className="section-heading centered">
          <p className="eyebrow">How it works</p>
          <h2>Simple hardware roles. One reliable classroom system.</h2>
          <p>The Arduino handles dependable sensor collection. The Raspberry Pi stores history, runs safety checks, serves the dashboard and securely sends selected data to the school portal.</p>
        </div>
        <div className="system-explorer">
          <div className="system-tabs" role="tablist" aria-label="Explore the EDUSENSE system layers">
            {(Object.keys(systemLayers) as Array<keyof typeof systemLayers>).map((key) => {
              const TabIcon = systemLayers[key].icon;
              return <button key={key} type="button" role="tab" aria-selected={systemLayer === key} className={systemLayer === key ? "active" : ""} onClick={() => setSystemLayer(key)}><TabIcon />{systemLayers[key].label}</button>;
            })}
          </div>
          <div className="system-panel" role="tabpanel">
            <span className="system-panel-icon"><LayerIcon /></span>
            <div><p className="eyebrow">{activeLayer.kicker}</p><h3>{activeLayer.title}</h3><p>{activeLayer.copy}</p></div>
            <ul>{activeLayer.points.map((point) => <li key={point}><Check size={15} />{point}</li>)}</ul>
          </div>
        </div>
        <div className="process-flow">
          <div><span>01</span><Microchip /><h3>Sense</h3><p>Arduino collects one complete environmental packet each second.</p></div>
          <ChevronRight className="flow-arrow" />
          <div><span>02</span><Network /><h3>Transfer</h3><p>USB serial carries the packet to the classroom Raspberry Pi.</p></div>
          <ChevronRight className="flow-arrow" />
          <div><span>03</span><Sparkles /><h3>Interpret</h3><p>Adaptive logic evaluates sustained change, trends and sensor correlation.</p></div>
          <ChevronRight className="flow-arrow" />
          <div><span>04</span><BellRing /><h3>Respond</h3><p>The backend updates the dashboard and safely controls alerts.</p></div>
        </div>
        <div className="technology-strip">
          <div><ShieldCheck /><span><b>Mandatory calibration</b> Every boot and Arduino reconnection begins a full sensor warm-up cycle.</span></div>
          <div><Database /><span><b>Persistent records</b> SQLite history survives power loss, reboot and application restart.</span></div>
          <div><LockKeyhole /><span><b>Private architecture</b> The public website never exposes live Pi addresses, classroom data or control endpoints.</span></div>
        </div>
        <div className="decision-explainer">
          <div><p className="eyebrow">How status changes</p><h3>A single spike is not treated like a sustained problem.</h3><p>The local engine compares filtered readings with each sensor's baseline, rate of rise and recent history. Multiple sensors rising together increases confidence.</p></div>
          <ol><li><b>SAFE</b><span>Stable around the classroom baseline.</span></li><li><b>ELEVATED</b><span>Minor sustained change; improve ventilation.</span></li><li><b>WARNING</b><span>Significant deterioration; alert a teacher.</span></li><li><b>DANGER</b><span>Confirmed hazardous pattern; follow emergency procedure.</span></li></ol>
        </div>
      </section>

      <section className="section demo-section" id="demo">
        <div className="section-heading split-heading">
          <div><p className="eyebrow">Dashboard demo</p><h2>See the signal behind the status.</h2></div>
          <p>This public demo uses fixed, sanitized sample data. It is not connected to a school, Raspberry Pi, or classroom control system.</p>
        </div>
        <figure className="dashboard-preview">
          <img src="/edusense-v7-dashboard.png" alt="EDUSENSE AI V7 light dashboard showing live classroom temperature, humidity and estimated gas readings" />
          <figcaption><span>Actual EDUSENSE AI V7 interface</span><small>Estimated gas readings are interpreted using each sensor's calibrated baseline and trend analysis.</small></figcaption>
        </figure>
        <div className="demo-shell">
          <aside className="sensor-rail" aria-label="Select sample sensor">
            {(Object.keys(sensors) as Array<keyof typeof sensors>).map((name) => (
              <button key={name} className={sensor === name ? "active" : ""} onClick={() => setSensor(name)} type="button"><span>{name}</span><small>{sensors[name].label}</small><ChevronRight size={16} /></button>
            ))}
          </aside>
          <div className="sensor-detail">
            <div className="detail-head">
              <div><span className={`sensor-state ${current.tone}`}>{current.tone}</span><h3>{sensor} · {current.label}</h3></div>
              <div className="range-control" aria-label="Sample chart range">
                {Object.keys(chartSets).map((item) => <button key={item} type="button" className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}
              </div>
            </div>
            <div className="metric-row">
              <div><span>Current</span><strong>{current.value}</strong><small>ADC</small></div>
              <div><span>Average</span><strong>{current.avg}</strong><small>ADC</small></div>
              <div><span>Lowest</span><strong>{current.low}</strong><small>ADC</small></div>
              <div><span>Highest</span><strong>{current.high}</strong><small>ADC</small></div>
              <div><span>vs baseline</span><strong>{current.change}</strong><small>rolling</small></div>
            </div>
            <div className="detail-chart" aria-label={`${sensor} sample readings for ${range}`}>
              <div className="chart-axis"><span>320</span><span>280</span><span>240</span><span>200</span></div>
              <div className="detail-bars">
                {chartData.map((height, index) => <i key={`${range}-${index}`} style={{ height: `${height}%` }}><span /></i>)}
              </div>
            </div>
            <div className="ai-advice"><Sparkles /><div><span>Reading summary</span><p>{current.advice}</p></div></div>
          </div>
        </div>
      </section>

      <section className="section pilot-section" id="pilot">
        <div className="pilot-intro">
          <p className="eyebrow">School pilot programme</p>
          <h2>Start with one classroom. Learn what matters.</h2>
          <p>A focused pilot helps your school establish a baseline, understand everyday patterns, and decide how environmental intelligence can support your priorities.</p>
          <a className="button" href="#contact">Register pilot interest <ArrowRight size={18} /></a>
        </div>
        <ol className="pilot-timeline">
          <li><span>1</span><div><h3>Readiness conversation</h3><p>We understand the classroom, network constraints and school objectives.</p></div></li>
          <li><span>2</span><div><h3>Guided installation</h3><p>The system is positioned, checked and prepared for its local environment.</p></div></li>
          <li><span>3</span><div><h3>Baseline period</h3><p>Staff observe normal patterns while EDUSENSE builds useful local context.</p></div></li>
          <li><span>4</span><div><h3>Pilot review</h3><p>We review the evidence, feedback and practical next steps with your team.</p></div></li>
        </ol>
      </section>

      <section className="section support-section" id="support">
        <div className="section-heading centered"><p className="eyebrow">Support</p><h2>Designed to be understood and maintained.</h2></div>
        <div className="support-grid">
          <article><BookOpen /><h3>School onboarding</h3><p>Clear guidance for setup, staff orientation and responsible dashboard use.</p></article>
          <article><LifeBuoy /><h3>Technical support</h3><p>Structured help for sensor, serial, Raspberry Pi and dashboard diagnostics.</p></article>
          <article><HeartPulse /><h3>System health</h3><p>Connection, storage and device states make operational issues visible.</p></article>
          <article><Download /><h3>Evidence export</h3><p>Historical records can support internal review and environmental reporting.</p></article>
        </div>
        <div className="faq-list">
          <details><summary>Does the public website connect to live classroom data?<ChevronDown /></summary><p>No. The public demo is deliberately isolated and uses sanitized sample data. Real classroom systems remain local and private.</p></details>
          <details><summary>What happens if the Raspberry Pi loses power?<ChevronDown /></summary><p>Readings already committed to SQLite remain available after restart. The system begins mandatory MQ sensor calibration again before environmental classification resumes.</p></details>
          <details><summary>Can a one-second spike trigger a danger alert?<ChevronDown /></summary><p>The decision engine validates consecutive readings, trends and correlated changes. A temporary spike is rejected unless an absolute critical pattern requires immediate attention.</p></details>
          <details><summary>Are MQ values laboratory-grade gas measurements?<ChevronDown /></summary><p>No. EDUSENSE labels converted values as estimated ppm. MQ sensors are used for classroom trend and anomaly monitoring; they are not a replacement for certified safety instruments.</p></details>
          <details><summary>Why not use only a Raspberry Pi?<ChevronDown /></summary><p>The Arduino gives the prototype stable, simple sensor acquisition while the Pi handles storage, networking and the dashboard. A future lower-cost edition may combine more of this work on an ESP32, but the current hardware architecture remains unchanged.</p></details>
        </div>
      </section>

      <section className="section about-section" id="about">
        <div><p className="eyebrow">About EDUSENSE</p><h2>Built where education, engineering and environmental responsibility meet.</h2></div>
        <div><p>EDUSENSE began as a working embedded-systems prototype built around an Arduino Uno, Raspberry Pi and real classroom sensors. The goal is practical: give schools clearer evidence without adding complexity to the school day.</p><p>The current version is a prototype and pilot platform, not a certified life-safety instrument. Its strength is transparent local history, baseline-aware monitoring and a dashboard that teachers can understand at a glance.</p></div>
      </section>

      <section className="section contact-section" id="contact">
        <div className="contact-copy">
          <p className="eyebrow">Start a conversation</p>
          <h2>Could EDUSENSE help your school?</h2>
          <p>Tell us about your school, classroom or pilot idea. We’ll use the details only to prepare your enquiry and discuss a suitable next step.</p>
          <div className="contact-points"><span><Check /> No obligation</span><span><Check /> School-focused discussion</span><span><Check /> Practical deployment guidance</span></div>
        </div>
        <form className="contact-form" onSubmit={submitInterest}>
          <label>Your name<input name="name" type="text" required autoComplete="name" /></label>
          <label>School or organisation<input name="school" type="text" required autoComplete="organization" /></label>
          <label>Email address<input name="email" type="email" required autoComplete="email" /></label>
          <label>Phone number (optional)<input name="phone" type="tel" autoComplete="tel" /></label>
          <label>Your enquiry<select name="interest" defaultValue="pilot"><option value="pilot">Classroom pilot</option><option value="demonstration">Product demonstration</option><option value="partnership">School or research partnership</option><option value="support">Customer support</option><option value="technical">Technical problem</option><option value="billing">Purchase or billing question</option><option value="other">Other enquiry</option></select></label>
          <label className="full-width">How can we help?<textarea name="message" rows={5} minLength={10} maxLength={4000} required placeholder="Describe your question, problem, affected device and any error shown." /></label>
          <label className="form-trap" aria-hidden="true">Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
          <button className="button full-width" type="submit" disabled={submitting}>{submitting ? "Sending..." : "Send to EDUSENSE support"} <ArrowRight size={18} /></button>
          {formStatus && <p className="form-status" role="status">{formStatus}</p>}
          {formError && <p className="form-error" role="alert">{formError}</p>}
        </form>
      </section>

      <footer>
        <div className="footer-main">
          <div><a className="brand brand-wordmark footer-wordmark" href="#top" aria-label="EDUSENSE AI home"><img src="/edusense-brand-logo.png" alt="EDUSENSE AI" /></a><p>Environmental intelligence for healthier, more responsive learning spaces.</p></div>
          <div><h3>Explore</h3><a href="#product">Product</a><a href="#technology">Technology</a><a href="#demo">Dashboard demo</a></div>
          <div><h3>Schools</h3><a href={cloudPortalUrl} target="_blank" rel="noreferrer">Device and parent login</a><a href="#schools">For schools</a><a href="#pilot">Pilot programme</a><a href="#support">Support</a></div>
          <div><h3>Connect</h3><a href="#about">About</a><a href="#contact">Contact</a><span>India</span></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} EDUSENSE AI. All rights reserved.</span><span>Public site · No live classroom data</span></div>
      </footer>
    </main>
  );
}
