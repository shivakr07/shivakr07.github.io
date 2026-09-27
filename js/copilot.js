/*
 * Minerva demo — an interactive, simplified re-creation of a multi-agent data
 * copilot. All tables, figures and names are illustrative sample data.
 */
(function () {
  'use strict';

  const AGENTS = [
    {
      id: 'kusto', name: 'Kusto agent', short: 'Kusto', color: 'blue', lang: 'KQL',
      source: 'Real-time telemetry · Eventhouse (KQL database)',
      scenarios: [
        {
          question: 'Which regions had the highest average CPU utilisation over the last 7 days?',
          plan: [
            'Intent: ranking · metric: CPU utilisation · aggregation: average',
            'Window: last 7 days, needing fresh sub-hour telemetry',
            'Best source for that grain and freshness: Kusto (VmTelemetry)',
            'Route → Kusto agent · confidence 0.94'
          ],
          query: 'VmTelemetry\n| where Timestamp > ago(7d)\n| summarize AvgCpu = round(avg(CpuPercent), 1) by Region\n| top 5 by AvgCpu desc',
          columns: ['Region', 'AvgCpu (%)'],
          rows: [['West Europe', 78.4], ['East US 2', 74.9], ['Southeast Asia', 71.2], ['Central India', 68.7], ['UK South', 63.1]],
          chart: 1,
          validation: 'VmTelemetryHourly\n| where Hour > ago(7d)\n| summarize AvgCpu = round(sum(CpuSum) / sum(SampleCount), 1) by Region\n| top 5 by AvgCpu desc',
          check: 'Independent hourly rollup returns the same ranking · max deviation 0.2 pts',
          answer: 'West Europe ran hottest over the last 7 days at 78.4% average CPU, followed by East US 2 (74.9%) and Southeast Asia (71.2%). All five regions are above the 60% planning threshold.'
        },
        {
          question: 'How many allocation failures did East US see in each 4-hour window today?',
          plan: [
            'Intent: time series · metric: allocation failures · filter: East US',
            'Window: last 24 hours in 4-hour bins',
            'Event-level data lives in Kusto (AllocationEvents)',
            'Route → Kusto agent · confidence 0.96'
          ],
          query: 'AllocationEvents\n| where Timestamp > ago(24h) and Region == "East US" and Result == "Failed"\n| summarize Failures = count() by bin(Timestamp, 4h)\n| order by Timestamp asc',
          columns: ['Window (UTC)', 'Failures'],
          rows: [['00:00', 14], ['04:00', 9], ['08:00', 31], ['12:00', 47], ['16:00', 22], ['20:00', 11]],
          chart: 1,
          validation: 'AllocationEvents\n| where Timestamp > ago(24h) and Region == "East US"\n| summarize Total = count(), Failed = countif(Result == "Failed")\n| extend FailureRate = round(100.0 * Failed / Total, 2)',
          check: 'Failed = 134 equals the sum of all windows · failure rate 0.87%',
          answer: 'East US logged 134 allocation failures in the last 24 hours. They peaked between 12:00 and 16:00 UTC (47), in line with the daily deployment peak, and were lowest overnight.'
        },
        {
          question: 'Which clusters crossed 85% core utilisation this week?',
          plan: [
            'Intent: threshold breach · metric: peak core utilisation',
            'Window: since the start of this week, per cluster',
            'Cluster-level utilisation is streamed into Kusto (ClusterUtilization)',
            'Route → Kusto agent · confidence 0.93'
          ],
          query: 'ClusterUtilization\n| where Timestamp > startofweek(now())\n| summarize PeakUtil = max(CoreUtilPercent) by ClusterId, Region\n| where PeakUtil > 85\n| order by PeakUtil desc',
          columns: ['Cluster', 'Region', 'Peak (%)'],
          rows: [['cls-weu-014', 'West Europe', 93.2], ['cls-eus2-007', 'East US 2', 89.6], ['cls-sea-021', 'Southeast Asia', 87.1], ['cls-cin-003', 'Central India', 85.4]],
          chart: 2,
          validation: 'ClusterUtilization\n| where Timestamp > startofweek(now())\n| where CoreUtilPercent > 85\n| summarize Breaches = dcount(ClusterId)',
          check: 'Breaches = 4 distinct clusters · matches the result set',
          answer: 'Four clusters breached 85% this week. cls-weu-014 in West Europe peaked highest at 93.2% and is the first candidate for rebalancing before the next demand cycle.'
        }
      ]
    },
    {
      id: 'lake', name: 'Lakehouse agent', short: 'Lakehouse', color: 'green', lang: 'Spark SQL',
      source: 'Curated history · Fabric Lakehouse (gold layer)',
      scenarios: [
        {
          question: 'How has monthly core demand trended over the last 6 months?',
          plan: [
            'Intent: trend · metric: core demand · grain: month',
            'Window: 6 months of history, needing curated, deduplicated data',
            'Best source: gold.fact_core_demand in the Lakehouse',
            'Route → Lakehouse agent · confidence 0.91'
          ],
          query: "SELECT date_format(demand_date, 'yyyy-MM') AS month,\n       ROUND(SUM(cores_requested) / 1e6, 2) AS cores_m\nFROM gold.fact_core_demand\nWHERE demand_date >= add_months(current_date(), -6)\nGROUP BY date_format(demand_date, 'yyyy-MM')\nORDER BY month",
          columns: ['Month', 'Cores (M)'],
          rows: [['2026-04', 3.82], ['2026-05', 3.95], ['2026-06', 4.11], ['2026-07', 4.36], ['2026-08', 4.52], ['2026-09', 4.71]],
          chart: 1,
          validation: "CoreDemandDaily\n| where DemandDate >= datetime_add('month', -6, now())\n| summarize CoresM = round(sum(CoresRequested) / 1e6, 2) by Month = format_datetime(DemandDate, 'yyyy-MM')\n| order by Month asc",
          check: '6 of 6 months match the Kusto mirror within 0.3%',
          answer: 'Core demand grew every month, from 3.82M in April to 4.71M in September: +23% over six months, with growth accelerating since July.'
        },
        {
          question: 'Which 5 subscriptions grew their allocated cores most this quarter?',
          plan: [
            'Intent: ranking · metric: quarter-over-quarter core growth',
            'Needs a join between allocation facts and the subscription dimension',
            'Best source: the Lakehouse star schema (fact + dim)',
            'Route → Lakehouse agent · confidence 0.89'
          ],
          query: "SELECT s.subscription_name,\n       SUM(f.cores_allocated) - SUM(f.cores_allocated_prev_q) AS core_growth\nFROM gold.fact_core_allocation AS f\nJOIN gold.dim_subscription AS s ON f.subscription_key = s.subscription_key\nWHERE f.quarter = '2026-Q3'\nGROUP BY s.subscription_name\nORDER BY core_growth DESC\nLIMIT 5",
          columns: ['Subscription', 'Core growth'],
          rows: [['Contoso Retail · Prod', 18400], ['Fabrikam Analytics', 15950], ['Northwind ML Training', 12300], ['Tailspin Media', 9870], ['Adventure Works ERP', 7420]],
          chart: 1,
          validation: "CoreAllocation\n| where Quarter in (\"2026-Q2\", \"2026-Q3\")\n| summarize Q2 = sumif(CoresAllocated, Quarter == \"2026-Q2\"), Q3 = sumif(CoresAllocated, Quarter == \"2026-Q3\") by SubscriptionName\n| extend CoreGrowth = Q3 - Q2\n| top 5 by CoreGrowth desc",
          check: 'Same five subscriptions in the same order · totals match',
          answer: 'Contoso Retail · Prod led growth with +18,400 cores this quarter, ahead of Fabrikam Analytics (+15,950). Together the top five added 63,940 cores.'
        },
        {
          question: 'What was forecast vs. actual capacity for Q3 by region?',
          plan: [
            'Intent: comparison · metrics: forecast and actual cores · grain: region',
            'Forecasts are batch-loaded and versioned, not streamed',
            'Best source: gold.fact_capacity_forecast in the Lakehouse',
            'Route → Lakehouse agent · confidence 0.92'
          ],
          query: "SELECT region,\n       SUM(forecast_cores) AS forecast,\n       SUM(actual_cores) AS actual,\n       ROUND(100.0 * (SUM(actual_cores) - SUM(forecast_cores)) / SUM(forecast_cores), 1) AS variance_pct\nFROM gold.fact_capacity_forecast\nWHERE quarter = '2026-Q3'\nGROUP BY region\nORDER BY variance_pct DESC",
          columns: ['Region', 'Forecast', 'Actual', 'Variance (%)'],
          rows: [['West Europe', 1200000, 1284000, 7.0], ['East US 2', 1450000, 1493500, 3.0], ['Central India', 640000, 652800, 2.0], ['Southeast Asia', 820000, 803600, -2.0]],
          chart: 2,
          validation: 'CapacityForecast\n| where Quarter == "2026-Q3"\n| summarize Forecast = sum(ForecastCores), Actual = sum(ActualCores) by Region\n| extend VariancePct = round(100.0 * (Actual - Forecast) / Forecast, 1)\n| order by VariancePct desc',
          check: 'Variance matches for all 4 regions',
          answer: 'West Europe beat its Q3 forecast by 7.0%, the largest gap, while Southeast Asia came in 2.0% under. The other regions landed within 3% of forecast.'
        }
      ]
    },
    {
      id: 'model', name: 'Semantic model agent', short: 'Semantic model', color: 'orange', lang: 'DAX',
      source: 'Governed KPIs · Power BI semantic model',
      scenarios: [
        {
          question: 'What is the current utilisation KPI by business unit?',
          plan: [
            'Intent: KPI lookup · measure: Core Utilisation %',
            'The KPI has a governed definition and target in the semantic model',
            'Use the model so the answer matches the official dashboard',
            'Route → Semantic model agent · confidence 0.96'
          ],
          query: "EVALUATE\nSUMMARIZECOLUMNS(\n    'Business Unit'[Business Unit],\n    \"Utilisation %\", [Core Utilisation %],\n    \"Target %\", [Utilisation Target %]\n)\nORDER BY [Utilisation %] DESC",
          columns: ['Business unit', 'Utilisation (%)', 'Target (%)'],
          rows: [['Cloud Gaming', 82.1, 80], ['AI Platform', 79.4, 80], ['Enterprise Apps', 71.8, 75], ['Developer Tools', 64.2, 70]],
          chart: 1,
          validation: 'CoreUsageDaily\n| where Date == startofday(ago(1d))\n| summarize Used = sum(CoresUsed), Available = sum(CoresAvailable) by BusinessUnit\n| extend UtilisationPct = round(100.0 * Used / Available, 1)\n| order by UtilisationPct desc',
          check: 'Raw usage reproduces the measure for every business unit · Δ ≤ 0.1',
          answer: 'Cloud Gaming is running above target at 82.1% utilisation, and AI Platform is just under its 80% target (79.4%). Enterprise Apps (71.8%) and Developer Tools (64.2%) are below target.'
        },
        {
          question: 'Compare year-over-year available capacity by region.',
          plan: [
            'Intent: year-over-year comparison · measure: Available Cores',
            'Time intelligence (same period last year) is defined in the model',
            'Use the model’s date table for a like-for-like comparison',
            'Route → Semantic model agent · confidence 0.94'
          ],
          query: "EVALUATE\nSUMMARIZECOLUMNS(\n    'Region'[Region],\n    \"Available\", [Available Cores],\n    \"Last year\", CALCULATE([Available Cores], SAMEPERIODLASTYEAR('Date'[Date])),\n    \"YoY %\", [Available Cores YoY %]\n)\nORDER BY [YoY %] DESC",
          columns: ['Region', 'Available', 'Last year', 'YoY (%)'],
          rows: [['Central India', 652800, 489600, 33.3], ['West Europe', 1284000, 1027200, 25.0], ['East US 2', 1493500, 1244600, 20.0], ['Southeast Asia', 803600, 730500, 10.0]],
          chart: 3,
          validation: 'CapacitySnapshot\n| where SnapshotDate in (startofday(now()), startofday(now() - 365d))\n| summarize Now = sumif(AvailableCores, SnapshotDate == startofday(now())), LastYear = sumif(AvailableCores, SnapshotDate < startofday(now())) by Region\n| extend YoYPct = round(100.0 * (Now - LastYear) / LastYear, 1)\n| order by YoYPct desc',
          check: 'Current and prior-year totals match for all regions',
          answer: 'Available capacity grew in every region year over year. Central India grew fastest (+33.3%), while Southeast Asia grew least (+10.0%).'
        },
        {
          question: 'Which regions are below the 20% headroom target?',
          plan: [
            'Intent: threshold filter · measure: Capacity Headroom %',
            'Headroom and its 20% target are governed KPIs in the model',
            'Filter the model result to regions below target',
            'Route → Semantic model agent · confidence 0.95'
          ],
          query: "EVALUATE\nFILTER(\n    SUMMARIZECOLUMNS(\n        'Region'[Region],\n        \"Headroom %\", [Capacity Headroom %]\n    ),\n    [Headroom %] < 0.20\n)\nORDER BY [Headroom %] ASC",
          columns: ['Region', 'Headroom (%)'],
          rows: [['West Europe', 12.4], ['East US 2', 16.8], ['Southeast Asia', 18.9]],
          chart: 1,
          validation: 'CapacitySnapshot\n| where SnapshotDate == startofday(now())\n| summarize Available = sum(AvailableCores), Used = sum(UsedCores) by Region\n| extend HeadroomPct = round(100.0 * (Available - Used) / Available, 1)\n| where HeadroomPct < 20\n| order by HeadroomPct asc',
          check: 'Both queries flag the same 3 regions',
          answer: 'Three regions are below the 20% headroom target. West Europe is tightest at 12.4%, followed by East US 2 (16.8%) and Southeast Asia (18.9%), so West Europe should be prioritised for new capacity.'
        }
      ]
    }
  ];

  const STEPS = [
    ['question', 'Question received'],
    ['plan', 'Orchestrator · planning'],
    ['guard', 'Guardrails'],
    ['route', 'Routing'],
    ['query', 'Generated query'],
    ['result', 'Result'],
    ['validate', 'Validation · equivalent KQL'],
    ['answer', 'Grounded answer']
  ];

  const root = document.getElementById('copilot');
  if (!root) return;
  const canvas = document.getElementById('scene-agents');
  const tabs = root.querySelector('.agent-tabs');
  const questions = root.querySelector('.agent-questions');
  const trace = root.querySelector('.trace');
  const status = root.querySelector('.trace-status');
  const esc = window.escapeHtml;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let agentIndex = 0;
  let runId = 0;
  let current = null;
  let timers = [];

  const later = (fn, ms) => { timers.push(setTimeout(fn, reduce ? 0 : ms)); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : esc(String(v)));

  function renderTabs() {
    tabs.innerHTML = AGENTS.map((a, i) => `
      <button type="button" role="tab" class="agent-tab agent-${a.color}" id="agent-tab-${a.id}"
        aria-selected="${i === agentIndex}" aria-controls="agent-questions" tabindex="${i === agentIndex ? 0 : -1}" data-index="${i}">
        <span class="agent-dot" aria-hidden="true"></span>${esc(a.name)}<small>${esc(a.lang)}</small>
      </button>`).join('');
  }

  function renderQuestions() {
    const a = AGENTS[agentIndex];
    questions.setAttribute('aria-labelledby', `agent-tab-${a.id}`);
    questions.innerHTML = `
      <p class="agent-source mono">${esc(a.source)}</p>
      ${a.scenarios.map((s, i) => `
        <button type="button" class="question" data-index="${i}">
          <span class="q-mark mono" aria-hidden="true">Q${i + 1}</span><span>${esc(s.question)}</span>
        </button>`).join('')}`;
  }

  function renderTrace() {
    trace.innerHTML = STEPS.map(([key, label], i) => `
      <li class="step" data-step="${key}" data-state="pending">
        <span class="step-icon" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <div class="step-body"><p class="step-label">${label}</p><div class="step-content"></div></div>
      </li>`).join('');
  }

  function step(key) { return trace.querySelector(`[data-step="${key}"]`); }
  function setState(key, state, html) {
    const el = step(key);
    if (!el) return;
    el.dataset.state = state;
    if (html != null) el.querySelector('.step-content').innerHTML = html;
  }
  function append(key, html) {
    const el = step(key);
    if (el) el.querySelector('.step-content').insertAdjacentHTML('beforeend', html);
  }

  function codeBlock(code, lang) {
    return `<pre class="code" data-lang="${esc(lang)}"><code>${window.highlight(code, lang.startsWith('Spark') ? 'sql' : lang.toLowerCase())}</code></pre>`;
  }

  function table(s) {
    return `<div class="table-wrap"><table class="result-table">
      <thead><tr>${s.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map((r) => `<tr>${r.map((v, i) => `<td${typeof v === 'number' ? ' class="num"' : ''}>${i === 0 ? esc(String(v)) : fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div><p class="step-meta mono">${s.rows.length} rows · illustrative data</p>`;
  }

  function typeInto(el, text, ms) {
    if (reduce) { el.textContent = text; return; }
    const words = text.split(' ');
    let i = 0;
    const per = Math.max(18, ms / words.length);
    const tick = () => {
      i += 1;
      el.textContent = words.slice(0, i).join(' ');
      if (i < words.length) timers.push(setTimeout(tick, per));
    };
    tick();
  }

  function onPhase(phase) {
    if (!current) return;
    const { a, s } = current;
    if (phase === 'route') {
      setState('question', 'done', `<p class="q-text">“${esc(s.question)}”</p>`);
      setState('plan', 'active', '<ul class="plan"></ul>');
      status.textContent = 'Orchestrator is planning…';
    } else if (phase === 'think') {
      const list = step('plan').querySelector('.plan');
      s.plan.forEach((line, i) => later(() => list.insertAdjacentHTML('beforeend', `<li>${esc(line)}</li>`), i * 420));
    } else if (phase === 'dispatch') {
      setState('plan', 'done');
      setState('guard', 'done', '<p>Entra ID token validated · row-level security applied · prompt passed RAI and DLP checks</p>');
      setState('route', 'done', `<p><span class="agent-pill agent-${a.color}">${esc(a.name)}</span> ${esc(a.source)}</p>`);
      setState('query', 'active', codeBlock(s.query, a.lang));
      status.textContent = `${a.name} is generating and running ${a.lang}…`;
    } else if (phase === 'validate') {
      setState('query', 'done');
      setState('result', 'done', table(s));
      setState('validate', 'active', codeBlock(s.validation, 'KQL'));
      status.textContent = 'Validator is cross-checking with an independent KQL query…';
    } else if (phase === 'answer') {
      setState('validate', 'done');
      append('validate', `<p class="check"><span aria-hidden="true">✓</span> ${esc(s.check)}</p>`);
      setState('answer', 'active', '<p class="answer-text"></p><p class="step-meta mono"></p>');
      typeInto(step('answer').querySelector('.answer-text'), s.answer, 900);
      status.textContent = 'Composing a grounded answer…';
    } else if (phase === 'done') {
      setState('answer', 'done');
      step('answer').querySelector('.step-meta').textContent = `Sources: ${a.source} · validated with KQL`;
      status.textContent = 'Done. Pick another question to run it again.';
      root.querySelectorAll('.question').forEach((b) => b.removeAttribute('aria-disabled'));
    }
  }

  function runScenario(i) {
    const a = AGENTS[agentIndex];
    const s = a.scenarios[i];
    clearTimers();
    runId += 1;
    current = { a, s, id: runId };
    renderTrace();
    root.querySelectorAll('.question').forEach((b, k) => b.classList.toggle('is-active', k === i));
    status.textContent = 'Sending question to the orchestrator…';
    if (stage) {
      stage.action('run', { agent: agentIndex, values: s.rows.map((r) => Number(r[s.chart])), id: runId });
    } else {
      ['route', 'think', 'dispatch', 'validate', 'answer', 'done'].forEach((p, k) => later(() => onPhase(p), k * 900));
    }
  }

  let stage = null;
  if (canvas && window.__stages) stage = window.__stages['scene-agents'] || null;
  if (stage) {
    stage.onStatus(({ phase, id }) => { if (current && id === current.id) onPhase(phase); });
  }

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.agent-tab');
    if (!btn) return;
    agentIndex = Number(btn.dataset.index);
    renderTabs();
    renderQuestions();
    tabs.querySelector(`[data-index="${agentIndex}"]`).focus();
  });
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    agentIndex = (agentIndex + (e.key === 'ArrowRight' ? 1 : AGENTS.length - 1)) % AGENTS.length;
    renderTabs();
    renderQuestions();
    tabs.querySelector(`[data-index="${agentIndex}"]`).focus();
  });
  questions.addEventListener('click', (e) => {
    const btn = e.target.closest('.question');
    if (btn) runScenario(Number(btn.dataset.index));
  });

  renderTabs();
  renderQuestions();
  renderTrace();
  status.textContent = 'Choose an agent, then pick a question to watch it run end to end.';
})();
