/**
 * FIRE Calculator — Switching Careers
 * Core calculation and rendering logic.
 */

/* ===== Helpers ===== */

/** Format a dollar value, e.g.  $1,234,567 */
function fmt(value) {
  const abs = Math.abs(value);
  let str;
  if (abs >= 1e9) str = (value / 1e9).toFixed(2) + 'B';
  else if (abs >= 1e6) str = (value / 1e6).toFixed(2) + 'M';
  else str = value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (value < 0 ? '-$' : '$') + (value < 0 ? str.replace('-', '') : str);
}

/* ===== Calculation Engine ===== */

/**
 * Build a year-by-year projection.
 *
 * All monetary inputs are in TODAY's dollars (nominal).
 * The model inflates expenses/income each year but keeps investment
 * returns as a REAL after-tax rate to simplify and stay intuitive.
 *
 * @param {Object} p – validated input parameters
 * @returns {{ years: number[], assets: number[], phases: Object[] }}
 */
function project(p) {
  // After-tax nominal annual return rate
  const grossRate = p.expectedReturn / 100;
  const afterTaxRate = grossRate * (1 - p.investmentTax / 100);
  // Real (inflation-adjusted) after-tax rate (Fisher equation)
  const inflationRate = p.inflation / 100;
  const realRate = (1 + afterTaxRate) / (1 + inflationRate) - 1;

  const years  = [];
  const assets = [];

  let portfolio = p.currentInvested;

  // Determine phases
  const phases = buildPhases(p);

  for (let age = p.currentAge; age < p.lifeExpectancy; age++) {
    years.push(age);
    assets.push(Math.round(portfolio));

    const phase = phases.find(ph => age >= ph.startAge && age < ph.endAge);
    if (!phase) break;

    // Monthly net savings (positive = saving, negative = drawing down)
    // All values are in real (today's) terms because we use realRate
    const monthlyNet = phase.monthlyIncome - phase.monthlyExpenses;
    const annualNet  = monthlyNet * 12;

    // Grow portfolio for one year then add/subtract net cash flow
    portfolio = portfolio * (1 + realRate) + annualNet;
  }

  // Final data point after last year of growth
  years.push(p.lifeExpectancy);
  assets.push(Math.round(portfolio));

  return { years, assets, phases };
}

/**
 * Define the three life phases for the simulation.
 */
function buildPhases(p) {
  return [
    {
      name: 'Current Career',
      startAge: p.currentAge,
      endAge: p.careerSwitchAge,
      monthlyIncome: p.monthlyIncome,
      monthlyExpenses: p.monthlyExpenses,
      color: '#3182ce',
    },
    {
      name: 'New Career',
      startAge: p.careerSwitchAge,
      endAge: p.retirementAge,
      monthlyIncome: p.newCareerIncome,
      monthlyExpenses: p.monthlyExpenses, // assume same lifestyle expenses
      color: '#d69e2e',
    },
    {
      name: 'Retirement',
      startAge: p.retirementAge,
      endAge: p.lifeExpectancy + 1,
      monthlyIncome: p.estimatedPension,
      monthlyExpenses: p.retiredExpenses,
      color: '#38a169',
    },
  ];
}

/* ===== Validation ===== */

function validate(p) {
  if (p.currentAge >= p.careerSwitchAge)
    return 'Career switch age must be greater than current age.';
  if (p.careerSwitchAge >= p.retirementAge)
    return 'Retirement age must be greater than career switch age.';
  if (p.retirementAge >= p.lifeExpectancy)
    return 'Life expectancy must be greater than retirement age.';
  if (p.expectedReturn <= 0)
    return 'Expected return must be greater than 0%.';
  return null;
}

/* ===== DOM Interactions ===== */

let chartInstance = null;

function getInputs() {
  const g = id => parseFloat(document.getElementById(id).value);
  return {
    currentAge:       g('currentAge'),
    lifeExpectancy:   g('lifeExpectancy'),
    careerSwitchAge:  g('careerSwitchAge'),
    retirementAge:    g('retirementAge'),
    monthlyIncome:    g('monthlyIncome'),
    monthlyExpenses:  g('monthlyExpenses'),
    newCareerIncome:  g('newCareerIncome'),
    retiredExpenses:  g('retiredExpenses'),
    estimatedPension: g('estimatedPension'),
    currentInvested:  g('currentInvested'),
    expectedReturn:   g('expectedReturn'),
    investmentTax:    g('investmentTax'),
    inflation:        g('inflation'),
  };
}

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg || '';
}

function renderSummary(p, assets, years) {
  const peakAsset    = Math.max(...assets);
  const peakAge      = years[assets.indexOf(peakAsset)];
  const finalAsset   = assets[assets.length - 1];
  const atRetirement = assets[years.indexOf(p.retirementAge)] ?? assets[assets.length - 1];

  const items = [
    { label: 'Portfolio at Retirement',  value: fmt(atRetirement), type: atRetirement >= 0 ? 'positive' : 'danger' },
    { label: 'Peak Portfolio',           value: `${fmt(peakAsset)} (age ${peakAge})`, type: 'info' },
    { label: 'Portfolio at End of Life', value: fmt(finalAsset), type: finalAsset >= 0 ? 'positive' : 'danger' },
    { label: 'Savings Phase (yrs)',      value: `${p.careerSwitchAge - p.currentAge}`, type: 'info' },
    { label: 'New Career Phase (yrs)',   value: `${p.retirementAge - p.careerSwitchAge}`, type: 'warning' },
    { label: 'Retirement Phase (yrs)',   value: `${p.lifeExpectancy - p.retirementAge}`, type: 'positive' },
  ];

  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = items.map(it => `
    <div class="summary-item ${it.type}">
      <span class="label">${it.label}</span>
      <span class="value">${it.value}</span>
    </div>`).join('');
}

function renderChart(years, assets, phases) {
  const ctx = document.getElementById('projectionChart').getContext('2d');

  // Build gradient fill segments per phase
  const pointColors = years.map(age => {
    const ph = phases.find(p => age >= p.startAge && age < p.endAge);
    return ph ? ph.color : phases[phases.length - 1].color;
  });

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: years.map(y => `Age ${y}`),
      datasets: [{
        label: 'Portfolio Value ($)',
        data: assets,
        borderColor: '#ed8936',
        backgroundColor: 'rgba(237,137,54,0.10)',
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: pointColors,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + fmt(ctx.parsed.y),
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: v => fmt(v),
            maxTicksLimit: 7,
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        x: {
          ticks: { maxTicksLimit: 12 },
          grid: { display: false },
        },
      },
    },
  });
}

function renderPhases(phases) {
  const container = document.getElementById('phasesDetail');
  const rows = phases.map(ph => {
    const monthlyNet = ph.monthlyIncome - ph.monthlyExpenses;
    const tag = monthlyNet >= 0 ? '↑ Saving' : '↓ Drawing down';
    const cls = monthlyNet >= 0 ? 'color:#276749' : 'color:#822727';
    return `
      <div class="phase-row" style="border-left:4px solid ${ph.color}">
        <span class="phase-name">${ph.name}</span>
        <span class="phase-range">Age ${ph.startAge}–${ph.endAge - 1}</span>
        <span class="phase-net" style="${cls}">${tag} ${fmt(Math.abs(monthlyNet))}/mo</span>
      </div>`;
  });

  container.innerHTML = `<h3>Phase Breakdown</h3>${rows.join('')}`;
}

/* ===== Main ===== */

document.getElementById('fireForm').addEventListener('submit', function (e) {
  e.preventDefault();
  showError('');

  const p = getInputs();
  const err = validate(p);
  if (err) { showError(err); return; }

  const { years, assets, phases } = project(p);

  const resultsEl = document.getElementById('results');
  resultsEl.classList.remove('hidden');

  renderSummary(p, assets, years);
  renderChart(years, assets, phases);
  renderPhases(phases);

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
