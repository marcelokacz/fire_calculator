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
  const yearlyPlan = [];

  let portfolio = p.currentInvested;

  // Determine phases
  const phases = buildPhases(p);

  for (let age = p.currentAge; age < p.lifeExpectancy; age++) {
    const phase = phases.find(ph => age >= ph.startAge && age < ph.endAge);
    if (!phase) break;

    // Monthly net savings (positive = saving, negative = drawing down)
    // All values are in real (today's) terms because we use realRate
    const monthlyNet = phase.monthlyIncome - phase.monthlyExpenses;
    const annualNet  = monthlyNet * 12;

    // Grow portfolio for one year then add/subtract net cash flow
    portfolio = portfolio * (1 + realRate) + annualNet;

    years.push(age);
    assets.push(Math.round(portfolio));
    yearlyPlan.push({
      age,
      annualNet,
      endValue: Math.round(portfolio),
    });
  }

  // Final data point after last year of growth
  years.push(p.lifeExpectancy);
  assets.push(Math.round(portfolio));

  return { years, assets, phases, yearlyPlan };
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
let budgetChartInstance = null;
let budgetState = null;

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

function getPhaseBudgetInfo(p, phaseName) {
  if (phaseName === 'Retirement') {
    return {
      name: phaseName,
      monthlyIncome: p.estimatedPension,
      monthlyExpenses: p.retiredExpenses,
      budget: p.retiredExpenses,
    };
  }
  if (phaseName === 'New Career') {
    return {
      name: phaseName,
      monthlyIncome: p.newCareerIncome,
      monthlyExpenses: p.monthlyExpenses,
      budget: p.monthlyExpenses,
    };
  }
  return {
    name: phaseName,
    monthlyIncome: p.monthlyIncome,
    monthlyExpenses: p.monthlyExpenses,
    budget: p.monthlyExpenses,
  };
}

function buildDefaultBudgetCategories(totalBudget) {
  const templates = [
    { name: 'Rent', share: 0.35 },
    { name: 'Groceries', share: 0.15 },
    { name: 'Utilities', share: 0.10 },
    { name: 'Transportation', share: 0.10 },
    { name: 'Other', share: 0.30 },
  ];

  const categories = templates.map(template => ({
    name: template.name,
    amount: Math.round(totalBudget * template.share),
  }));

  const total = categories.reduce((sum, category) => sum + category.amount, 0);
  if (categories.length && total !== totalBudget) {
    categories[categories.length - 1].amount += totalBudget - total;
  }

  return categories.map(category => ({
    ...category,
    percentage: totalBudget > 0 ? (category.amount / totalBudget) * 100 : 0,
  }));
}

function buildBudgetState(p) {
  const phaseNames = ['Current Career', 'New Career', 'Retirement'];
  const phases = phaseNames.reduce((acc, phaseName) => {
    const info = getPhaseBudgetInfo(p, phaseName);
    acc[phaseName] = {
      budget: info.budget,
      monthlyIncome: info.monthlyIncome,
      monthlyExpenses: info.monthlyExpenses,
      categories: buildDefaultBudgetCategories(info.budget),
    };
    return acc;
  }, {});

  return {
    selectedPhase: 'Current Career',
    phases,
  };
}

function getBudgetPhaseState(phaseName) {
  if (!budgetState || !budgetState.phases[phaseName]) return null;
  return budgetState.phases[phaseName];
}

function getBudgetPhaseSummary(phaseName) {
  const phase = getBudgetPhaseState(phaseName);
  if (!phase) return null;

  const categoryTotal = phase.categories.reduce((sum, category) => sum + category.amount, 0);
  const monthlyIncome = Number.isFinite(phase.monthlyIncome) ? phase.monthlyIncome : 0;
  const savingsAmount = monthlyIncome - phase.budget;
  const warning = categoryTotal > phase.budget || savingsAmount < 0
    ? (categoryTotal > phase.budget ? 'Category totals exceed the available budget.' : 'This phase is spending more than its monthly income.')
    : '';

  return { phase, categoryTotal, savingsAmount, warning };
}

function syncCategoriesToBudget(phaseState, changedIndex, field, value) {
  const totalBudget = Math.max(0, phaseState.budget);
  if (!phaseState.categories.length) return;

  if (field === 'name') {
    phaseState.categories[changedIndex].name = value || 'Category';
    return;
  }

  if (field === 'amount') {
    const nextAmount = Math.max(0, Math.round(value));
    phaseState.categories[changedIndex].amount = nextAmount;
  } else {
    const nextPercent = Math.max(0, parseFloat(value));
    phaseState.categories[changedIndex].percentage = Number.isFinite(nextPercent) ? nextPercent : 0;
  }

  if (field === 'amount') {
    const otherTotal = phaseState.categories.reduce((sum, category, index) => {
      return sum + (index === changedIndex ? 0 : category.amount);
    }, 0);
    const targetOtherTotal = Math.max(0, totalBudget - phaseState.categories[changedIndex].amount);
    const otherIndices = phaseState.categories.map((_, index) => index).filter(index => index !== changedIndex);

    if (otherIndices.length) {
      let remaining = targetOtherTotal;
      if (otherTotal > 0) {
        otherIndices.forEach(index => {
          const share = phaseState.categories[index].amount / otherTotal;
          const adjustedAmount = Math.round(targetOtherTotal * share);
          phaseState.categories[index].amount = adjustedAmount;
          remaining -= adjustedAmount;
        });
      } else {
        const base = Math.floor(targetOtherTotal / otherIndices.length);
        otherIndices.forEach((index, idx) => {
          phaseState.categories[index].amount = idx === otherIndices.length - 1
            ? targetOtherTotal - base * (otherIndices.length - 1)
            : base;
        });
        remaining = 0;
      }

      if (remaining !== 0) {
        phaseState.categories[otherIndices[otherIndices.length - 1]].amount += remaining;
      }
    } else {
      phaseState.categories[changedIndex].amount = totalBudget;
    }
  } else {
    const totalPercent = phaseState.categories.reduce((sum, category, index) => {
      return sum + (index === changedIndex ? 0 : category.percentage);
    }, 0) + phaseState.categories[changedIndex].percentage;
    const normalizedPercent = totalPercent > 0 ? phaseState.categories[changedIndex].percentage / totalPercent : 0;
    const scaledBudget = totalBudget * normalizedPercent;
    phaseState.categories[changedIndex].amount = Math.round(scaledBudget);

    const otherIndices = phaseState.categories.map((_, index) => index).filter(index => index !== changedIndex);
    const remainingBudget = Math.max(0, totalBudget - phaseState.categories[changedIndex].amount);
    const otherTotalPercent = otherIndices.reduce((sum, index) => sum + phaseState.categories[index].percentage, 0);

    if (otherIndices.length) {
      let remaining = remainingBudget;
      if (otherTotalPercent > 0) {
        otherIndices.forEach(index => {
          const share = phaseState.categories[index].percentage / otherTotalPercent;
          const adjustedAmount = Math.round(remainingBudget * share);
          phaseState.categories[index].amount = adjustedAmount;
          remaining -= adjustedAmount;
        });
      } else {
        const base = Math.floor(remainingBudget / otherIndices.length);
        otherIndices.forEach((index, idx) => {
          const amount = idx === otherIndices.length - 1
            ? remainingBudget - base * (otherIndices.length - 1)
            : base;
          phaseState.categories[index].amount = amount;
          remaining -= amount;
        });
      }

      if (remaining !== 0) {
        phaseState.categories[otherIndices[otherIndices.length - 1]].amount += remaining;
      }
    }
  }

  const totalAllocated = phaseState.categories.reduce((sum, category) => sum + category.amount, 0);
  if (phaseState.categories.length) {
    phaseState.categories[phaseState.categories.length - 1].amount += totalBudget - totalAllocated;
  }

  phaseState.categories.forEach(category => {
    category.percentage = totalBudget > 0 ? (category.amount / totalBudget) * 100 : 0;
  });
}

function addBudgetCategory(phaseName) {
  const phase = getBudgetPhaseState(phaseName);
  if (!phase) return;
  const nextIndex = phase.categories.length;
  const baseAmount = Math.max(50, Math.round(phase.budget * 0.1));
  const totalExisting = phase.categories.reduce((sum, category) => sum + category.amount, 0);
  const availableBudget = Math.max(0, phase.budget - totalExisting);
  const amount = availableBudget > 0 ? Math.min(baseAmount, availableBudget) : 0;
  phase.categories.push({ name: `Category ${nextIndex + 1}`, amount, percentage: phase.budget > 0 ? (amount / phase.budget) * 100 : 0 });
  const totalAllocated = phase.categories.reduce((sum, category) => sum + category.amount, 0);
  const adjustment = phase.budget - totalAllocated;
  if (phase.categories.length && adjustment !== 0) {
    const targetIndex = phase.categories.length > 1 ? phase.categories.length - 2 : phase.categories.length - 1;
    phase.categories[targetIndex].amount += adjustment;
    phase.categories[targetIndex].percentage = phase.budget > 0 ? (phase.categories[targetIndex].amount / phase.budget) * 100 : 0;
  }
  renderBudgetAllocation();
}

function removeBudgetCategory(phaseName, index) {
  const phase = getBudgetPhaseState(phaseName);
  if (!phase || phase.categories.length <= 1) return;
  const removedAmount = phase.categories[index].amount;
  phase.categories.splice(index, 1);
  if (phase.categories.length) {
    const otherTotal = phase.categories.reduce((sum, category) => sum + category.amount, 0);
    const remainingBudget = Math.max(0, phase.budget - otherTotal);
    if (remainingBudget > 0) {
      phase.categories[phase.categories.length - 1].amount += remainingBudget;
    }
    phase.categories.forEach(category => {
      category.percentage = phase.budget > 0 ? (category.amount / phase.budget) * 100 : 0;
    });
  }
  renderBudgetAllocation();
}

function getBudgetChartColors(count) {
  const palette = ['#3182ce', '#d69e2e', '#38a169', '#805ad5', '#e53e3e', '#4a5568', '#0f766e', '#b45309'];
  return Array.from({ length: count }, (_, index) => palette[index % palette.length]);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function syncBudgetStateToInputs(p) {
  const nextState = buildBudgetState(p);
  if (!budgetState) return nextState;

  Object.keys(nextState.phases).forEach(phaseName => {
    const previousPhase = budgetState.phases[phaseName];
    const nextPhase = nextState.phases[phaseName];
    if (!previousPhase || !previousPhase.categories.length) return;

    const categories = previousPhase.categories.map(category => ({ ...category }));
    const totalBudget = nextPhase.budget;
    const totalExisting = categories.reduce((sum, category) => sum + category.amount, 0);

    if (totalBudget <= 0) {
      nextPhase.categories = categories.map(category => ({ ...category, amount: 0, percentage: 0 }));
      return;
    }

    if (totalExisting <= 0) {
      nextPhase.categories = buildDefaultBudgetCategories(totalBudget);
      return;
    }

    const scale = totalBudget / totalExisting;
    categories.forEach(category => {
      category.amount = Math.max(0, Math.round(category.amount * scale));
      category.percentage = (category.amount / totalBudget) * 100;
    });

    const adjustedTotal = categories.reduce((sum, category) => sum + category.amount, 0);
    categories[categories.length - 1].amount += totalBudget - adjustedTotal;
    categories[categories.length - 1].percentage = (categories[categories.length - 1].amount / totalBudget) * 100;
    nextPhase.categories = categories;
  });

  nextState.selectedPhase = budgetState.selectedPhase || 'Current Career';
  return nextState;
}

function renderBudgetAllocation(p) {
  if (!budgetState) {
    if (!p) return;
    budgetState = buildBudgetState(p);
  }

  const select = document.getElementById('budgetPhaseSelect');
  const phaseNames = Object.keys(budgetState.phases);
  select.innerHTML = phaseNames.map(phaseName => `<option value="${escapeHtml(phaseName)}"${phaseName === budgetState.selectedPhase ? ' selected' : ''}>${escapeHtml(phaseName)}</option>`).join('');

  const phaseName = select.value || budgetState.selectedPhase;
  budgetState.selectedPhase = phaseName;
  const summary = getBudgetPhaseSummary(phaseName);
  if (!summary) return;

  const { phase, categoryTotal, savingsAmount, warning } = summary;
  const rows = phase.categories.map((category, index) => `
    <div class="budget-category-row" data-index="${index}">
      <input class="budget-name-input" type="text" value="${escapeHtml(category.name)}" data-field="name" />
      <input class="budget-amount-input" type="number" min="0" step="1" value="${Math.round(category.amount)}" data-field="amount" />
      <input class="budget-percent-input" type="number" min="0" max="100" step="0.1" value="${category.percentage.toFixed(1)}" data-field="percent" />
      <button type="button" class="btn-remove-category" data-index="${index}">Remove</button>
    </div>`).join('');

  document.getElementById('budgetCategoryRows').innerHTML = rows;
  document.getElementById('budgetSavingsAmount').textContent = fmt(savingsAmount);
  const warningEl = document.getElementById('budgetWarning');
  warningEl.textContent = warning;
  warningEl.classList.toggle('hidden', !warning);

  if (budgetChartInstance) budgetChartInstance.destroy();
  const chartCtx = document.getElementById('budgetChart').getContext('2d');
  const chartLabels = phase.categories.map(category => category.name);
  const chartData = phase.categories.map(category => Math.max(0, category.amount));
  const chartColors = getBudgetChartColors(phase.categories.length);
  const savingsAmount = Math.max(0, phase.monthlyIncome - phase.budget);

  if (savingsAmount > 0) {
    chartLabels.push('Savings');
    chartData.push(savingsAmount);
    chartColors.push('#38a169');
  }

  budgetChartInstance = new Chart(chartCtx, {
    type: 'doughnut',
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartData,
        backgroundColor: chartColors,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: item => `${item.label}: ${fmt(item.parsed)}` } },
      },
    },
  });
}

function handleBudgetPhaseChange(event) {
  if (!budgetState) return;
  budgetState.selectedPhase = event.target.value;
  renderBudgetAllocation();
}

function handleBudgetCategoryInput(event) {
  if (!budgetState) return;
  const row = event.target.closest('.budget-category-row');
  if (!row) return;
  const phaseName = budgetState.selectedPhase;
  const phase = getBudgetPhaseState(phaseName);
  if (!phase) return;
  const index = parseInt(row.dataset.index, 10);
  const field = event.target.dataset.field;
  const value = event.target.value;
  syncCategoriesToBudget(phase, index, field, value);
  renderBudgetAllocation();
}

function handleBudgetCategoryClick(event) {
  if (!budgetState || !event.target.classList.contains('btn-remove-category')) return;
  const phaseName = budgetState.selectedPhase;
  const index = parseInt(event.target.dataset.index, 10);
  removeBudgetCategory(phaseName, index);
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

  // Colour each bar by phase
  const barColors = years.map(age => {
    const ph = phases.find(p => age >= p.startAge && age < p.endAge);
    return ph ? ph.color : phases[phases.length - 1].color;
  });

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: years.map(y => `${y}`),
      datasets: [{
        label: 'Portfolio Value ($)',
        data: assets,
        backgroundColor: barColors,
        borderWidth: 0,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `Age ${items[0].label}`,
            label: item => {
              const age = parseInt(item.label, 10);
              const ph = phases.find(p => age >= p.startAge && age < p.endAge)
                      || phases[phases.length - 1];
              return ` ${ph.name}: ${fmt(item.parsed.y)}`;
            },
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
          ticks: { maxTicksLimit: 14, font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });

  // Render a simple colour legend below the chart
  const legend = document.getElementById('chartLegend');
  legend.innerHTML = phases.map(ph =>
    `<span class="legend-item">
       <span class="legend-swatch" style="background:${ph.color}"></span>${ph.name}
     </span>`
  ).join('');
}

function renderPhases(phases) {
  const container = document.getElementById('phasesDetail');
  const rows = phases.map(ph => {
    const monthlyNet = ph.monthlyIncome - ph.monthlyExpenses;
    const tag = monthlyNet >= 0 ? '↑ Saving' : '↓ Drawing down';
    const cls = monthlyNet >= 0 ? 'color:#1a7a4a' : 'color:#c00';
    return `
      <div class="phase-row">
        <span class="phase-name">${ph.name}</span>
        <span class="phase-range">Age ${ph.startAge}–${ph.endAge - 1}</span>
        <span class="phase-net" style="${cls}">${tag} ${fmt(Math.abs(monthlyNet))}/mo</span>
      </div>`;
  });

  container.innerHTML = `<h3>Phase Breakdown</h3>${rows.join('')}`;
}

document.getElementById('budgetPhaseSelect').addEventListener('change', handleBudgetPhaseChange);
document.getElementById('addBudgetCategoryBtn').addEventListener('click', function () {
  addBudgetCategory(budgetState ? budgetState.selectedPhase : 'Current Career');
});
document.getElementById('budgetCategoryRows').addEventListener('change', handleBudgetCategoryInput);
document.getElementById('budgetCategoryRows').addEventListener('click', handleBudgetCategoryClick);

function renderYearlyPlan(yearlyPlan) {
  const body = document.getElementById('yearlyPlanTableBody');
  body.innerHTML = yearlyPlan.map(row => {
    const amountClass = row.annualNet >= 0 ? 'amount-positive' : 'amount-negative';
    const amountText = `${fmt(row.annualNet)}/yr`;
    return `
      <tr>
        <td>${row.age}</td>
        <td>${fmt(row.endValue)}</td>
        <td class="manual-cell"></td>
      </tr>`;
  }).join('');
}

/* ===== Main ===== */

document.getElementById('fireForm').addEventListener('submit', function (e) {
  e.preventDefault();
  showError('');

  const p = getInputs();
  const err = validate(p);
  if (err) { showError(err); return; }

  const { years, assets, phases, yearlyPlan } = project(p);

  const resultsEl = document.getElementById('results');
  resultsEl.classList.remove('hidden');

  renderSummary(p, assets, years);
  renderChart(years, assets, phases);
  renderPhases(phases);
  budgetState = syncBudgetStateToInputs(p);
  renderBudgetAllocation(p);
  renderYearlyPlan(yearlyPlan);

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('exportPdfBtn').addEventListener('click', function () {
  window.print();
});
