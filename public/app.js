// -------------------------------------------------------------
// STATE VARIABLES & DOM ELEMENTS
// -------------------------------------------------------------

let state = {
  employees: [],
  accrualBalances: [],
  departments: [],
  workflows: [],
  notifications: [],
  logs: []
};

let currentEmployeeId = 'emp_101'; // Default: Alice Vance
let activeTableTab = 'employees'; // default active DB table

// DOM Cache
const selectEmployee = document.getElementById('select-employee');
const profileAvatar = document.getElementById('profile-avatar');
const profileName = document.getElementById('profile-name');
const profileRole = document.getElementById('profile-role');
const profileBadges = document.getElementById('profile-badges');

const balAccrued = document.getElementById('bal-accrued');
const balRollover = document.getElementById('bal-rollover');
const balUsed = document.getElementById('bal-used');
const balNet = document.getElementById('bal-net');

const formRequest = document.getElementById('form-request');
const inputStart = document.getElementById('input-start');
const inputEnd = document.getElementById('input-end');
const inputReason = document.getElementById('input-reason');
const ruleWarnPane = document.getElementById('rule-warn-pane');

const tabSimulate = document.getElementById('tab-simulate');
const tabDatabase = document.getElementById('tab-database');
const tabLabs = document.getElementById('tab-labs');

const panelSimulate = document.getElementById('panel-simulate');
const panelDatabase = document.getElementById('panel-database');
const panelLabs = document.getElementById('panel-labs');

const tableWorkflowsBody = document.getElementById('table-workflows-body');
const terminalStream = document.getElementById('terminal-stream');
const logCounter = document.getElementById('log-counter');

const dbInspectorTableWrapper = document.getElementById('db-inspector-table-wrapper');

const notifCenter = document.getElementById('notif-center');
const notifBadge = document.getElementById('notif-badge');
const btnReset = document.getElementById('btn-reset');
const toastContainer = document.getElementById('toast-container');

// -------------------------------------------------------------
// INITIALIZATION & EVENT LISTENERS
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchState(true); // Initial load, populate selectors
});

function setupEventListeners() {
  // Tab Routing
  tabSimulate.addEventListener('click', () => switchTab('simulate'));
  tabDatabase.addEventListener('click', () => switchTab('database'));
  tabLabs.addEventListener('click', () => switchTab('labs'));

  // Database Inspector Sidebar Table Tabs
  const dbTabButtons = document.querySelectorAll('.db-tabs-sidebar .db-tab-btn');
  dbTabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      dbTabButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeTableTab = e.target.getAttribute('data-table');
      renderDBInspectors();
    });
  });

  // Role Swap Listener
  selectEmployee.addEventListener('change', (e) => {
    currentEmployeeId = e.target.value;
    updateActiveProfile();
    renderWorkflows();
    showToast('info', `Swapped active student role to ${state.employees.find(emp => emp.id === currentEmployeeId).name}`);
    fetchState(false); // Trigger fetch and dynamic read routing path animation
  });

  // Request Form Submit
  formRequest.addEventListener('submit', handleRequestSubmit);

  // Reset Button
  btnReset.addEventListener('click', handleReset);

  // Interactive Live Rule Checking
  inputStart.addEventListener('change', checkLiveRules);
  inputEnd.addEventListener('change', checkLiveRules);

  // Notification center click clear
  notifCenter.addEventListener('click', () => {
    clearNotifications();
  });
}

function switchTab(target) {
  [tabSimulate, tabDatabase, tabLabs].forEach(b => b.classList.remove('active'));
  [panelSimulate, panelDatabase, panelLabs].forEach(p => p.classList.remove('active'));

  if (target === 'simulate') {
    tabSimulate.classList.add('active');
    panelSimulate.classList.add('active');
  } else if (target === 'database') {
    tabDatabase.classList.add('active');
    panelDatabase.classList.add('active');
    renderDBInspectors();
  } else if (target === 'labs') {
    tabLabs.classList.add('active');
    panelLabs.classList.add('active');
  }
}

// -------------------------------------------------------------
// RECOVERY & DATA FETCHING
// -------------------------------------------------------------

function getProfileRegion(employeeId) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (emp && emp.country !== 'US') {
    return 'eu';
  }
  return 'us';
}

async function fetchState(initSelector = false) {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('API server returned error code');
    state = await res.json();
    
    if (initSelector) {
      populateEmployeeSelector();
    }
    
    updateActiveProfile();
    renderWorkflows();
    renderLogs();
    renderNotificationsBadge();
    
    if (!initSelector) {
      const region = getProfileRegion(currentEmployeeId);
      const routingStatus = res.headers.get('X-Region-Routing-Status');
      triggerReadAnimation(region, routingStatus);
    }
  } catch (err) {
    console.error('Fetch state error:', err);
    showToast('error', 'Failed to retrieve cluster status.');
  }
}

function triggerReadAnimation(region, routingStatus) {
  (async () => {
    await animatePacket('browser', 'gclb');
    if (region === 'us') {
      await animatePacket('gclb', 'fe-us');
      await animatePacket('fe-us', 'db-us');
    } else {
      await animatePacket('gclb', 'fe-eu');
      if (routingStatus === 'CROSS_ATLANTIC_HOP_DETECTED') {
        await animatePacket('fe-eu', 'db-us'); // Transatlantic Hop!
      } else {
        await animatePacket('fe-eu', 'db-eu'); // Local Read Replica!
      }
    }
  })();
}

// -------------------------------------------------------------
// RENDERERS & POPULATORS
// -------------------------------------------------------------

function populateEmployeeSelector() {
  selectEmployee.innerHTML = '';
  let hasStudent = false;
  state.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.innerText = `${e.name} (${e.sector} - ${e.role})`;
    selectEmployee.appendChild(opt);
    if (e.id === 'emp_student') hasStudent = true;
  });
  if (hasStudent) {
    currentEmployeeId = 'emp_student';
  }
  selectEmployee.value = currentEmployeeId;
}

function updateActiveProfile() {
  const emp = state.employees.find(e => e.id === currentEmployeeId);
  const bal = state.accrualBalances.find(b => b.employee_id === currentEmployeeId);

  if (!emp || !bal) return;

  profileAvatar.innerText = emp.name.charAt(0);
  profileName.innerText = emp.name;
  profileRole.innerText = `${emp.role} (${emp.sector})`;

  // Badges
  profileBadges.innerHTML = `
    <span class="badge badge-sector">${emp.sector}</span>
    <span class="badge badge-country">ISO-${emp.country}</span>
  `;

  // Balances
  balAccrued.innerText = bal.accrued_days;
  balRollover.innerText = bal.rollover_days;
  balUsed.innerText = bal.used_days;
  
  const net = (bal.accrued_days + bal.rollover_days) - bal.used_days;
  balNet.innerText = net;
}

function renderWorkflows() {
  tableWorkflowsBody.innerHTML = '';

  state.workflows.forEach(w => {
    const tr = document.createElement('tr');
    
    // Status Badge Styling
    let statusClass = 'badge-pending';
    if (w.status === 'approved') statusClass = 'badge-approved';
    if (w.status === 'rejected') statusClass = 'badge-rejected';

    // Check if manager is viewing and this is pending review
    const empProfile = state.employees.find(e => e.id === currentEmployeeId);
    const isManager = empProfile ? empProfile.id === w.approval_chain[0] : false;
    const isPending = w.status === 'pending';

    let actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">Archive locked</span>`;
    if (isPending && isManager) {
      actionsHtml = `
        <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
          <button class="btn btn-small" onclick="handleWorkflowAction('${w.id}', 'approve')">Approve</button>
          <button class="btn btn-secondary btn-small" onclick="handleWorkflowAction('${w.id}', 'reject')">Reject</button>
        </div>
      `;
    } else if (isPending && !isManager) {
      actionsHtml = `<span class="badge-pending" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">Awaiting Manager</span>`;
    }

    tr.innerHTML = `
      <td><code>${w.id}</code></td>
      <td><strong>${w.employee_name}</strong></td>
      <td><span class="badge badge-sector">${w.sector}</span></td>
      <td>${w.start_date} to ${w.end_date}</td>
      <td>${w.days_requested}</td>
      <td><span class="status-badge ${statusClass}">${w.status.toUpperCase()}</span></td>
      <td><code>${w.current_step}</code></td>
      <td style="text-align: right;">${actionsHtml}</td>
    `;
    tableWorkflowsBody.appendChild(tr);
  });
}

function renderLogs() {
  terminalStream.innerHTML = '';
  logCounter.innerText = `${state.logs.length} operations logged`;

  state.logs.forEach(log => {
    const div = document.createElement('div');
    div.className = `log-line log-${log.type}`;
    div.innerHTML = `
      <span class="log-time">[${new Date(log.timestamp).toLocaleTimeString()}]</span>
      <span class="log-message">${log.message}</span>
    `;
    terminalStream.appendChild(div);
  });
}

function renderNotificationsBadge() {
  const count = state.notifications.filter(n => n.user_id === currentEmployeeId && !n.read).length;
  if (count > 0) {
    notifBadge.innerText = count;
    notifBadge.style.display = 'block';
  } else {
    notifBadge.style.display = 'none';
  }
}

// -------------------------------------------------------------
// EVENT HANDLERS & ACTIONS
// -------------------------------------------------------------

async function handleRequestSubmit(e) {
  e.preventDefault();

  const body = {
    employee_id: currentEmployeeId,
    start_date: inputStart.value,
    end_date: inputEnd.value,
    reason: inputReason.value
  };

  try {
    const region = getProfileRegion(currentEmployeeId);
    
    // 1. Animate Browser -> GCLB
    await animatePacket('browser', 'gclb');
    
    // 2. Animate GCLB to regional Cloud Run
    if (region === 'us') {
      await animatePacket('gclb', 'fe-us');
    } else {
      await animatePacket('gclb', 'fe-eu');
    }

    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      showToast('error', `Rejected: ${data.error}`);
      return;
    }

    // 3. Animate Cloud Run Frontend to database (Writes go to US Primary!)
    if (region === 'us') {
      await animatePacket('fe-us', 'db-us');
    } else {
      await animatePacket('fe-eu', 'db-us');
    }

    showToast('success', `Success: Vacation request ${data.requestId} has been submitted!`);
    formRequest.reset();
    ruleWarnPane.innerHTML = '';
    
    await fetchState(false);
  } catch (err) {
    console.error('Submit API connection failed:', err);
    showToast('error', 'Backend Core is unreachable.');
  }
}

async function handleWorkflowAction(requestId, action) {
  try {
    const region = getProfileRegion(currentEmployeeId);

    await animatePacket('browser', 'gclb');
    if (region === 'us') {
      await animatePacket('gclb', 'fe-us');
    } else {
      await animatePacket('gclb', 'fe-eu');
    }

    const res = await fetch(`/api/requests/${requestId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        actor_id: currentEmployeeId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast('error', `Workflow error: ${data.error}`);
      return;
    }

    // Action committed - animate Cloud Run to US DB Primary
    if (region === 'us') {
      await animatePacket('fe-us', 'db-us');
    } else {
      await animatePacket('fe-eu', 'db-us');
    }

    showToast('success', `Workflow committed: ${requestId} status updated to ${action.toUpperCase()}.`);
    await fetchState(false);
  } catch (err) {
    console.error('Workflow update failed:', err);
    showToast('error', 'Failed to submit workflow resolution.');
  }
}

async function handleReset() {
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('info', 'System reset: Clean DB structures deployed.');
      currentEmployeeId = 'emp_101'; // restore Alice
      await fetchState(true);
    }
  } catch (err) {
    showToast('error', 'Reset trigger failed.');
  }
}

// -------------------------------------------------------------
// LIVE RULES PANE & ANALYSIS
// -------------------------------------------------------------

function checkLiveRules() {
  const startVal = inputStart.value;
  const endVal = inputEnd.value;
  
  if (!startVal || !endVal) {
    ruleWarnPane.innerHTML = '';
    return;
  }

  const sDate = new Date(startVal);
  const eDate = new Date(endVal);
  const employee = state.employees.find(e => e.id === currentEmployeeId);
  const balance = state.accrualBalances.find(b => b.employee_id === currentEmployeeId);

  if (!employee || !balance) return;

  if (sDate > eDate) {
    renderRuleNotice('error', 'Logic Violation: Start date cannot exceed the End date.');
    return;
  }

  const reqDays = calculateBusinessDays(sDate, eDate);
  if (reqDays <= 0) {
    renderRuleNotice('error', 'Calendar Out of Bounds: Range contains no business days (Mon-Fri).');
    return;
  }

  const netAvailable = (balance.accrued_days + balance.rollover_days) - balance.used_days;
  if (reqDays > netAvailable) {
    renderRuleNotice('error', `Insufficient Balance: Requesting ${reqDays} days but only ${netAvailable} available.`);
    return;
  }

  // 1. Retail Blackouts (Nov 15 - Jan 5)
  if (employee.sector === 'Retail') {
    const isBlackout = datesOverlap(startVal, endVal, `${sDate.getFullYear()}-11-15`, `${sDate.getFullYear()}-12-31`) ||
                      datesOverlap(startVal, endVal, `${sDate.getFullYear()}-01-01`, `${sDate.getFullYear()}-01-05`);
    if (isBlackout) {
      renderRuleNotice('warning', 'Holiday Blackout Threshold: High retail volume range. Submission requires VP escalation overrides.');
      return;
    }
  }

  // 2. Financial Blackouts (fiscal quarter final 5 business days)
  if (employee.sector === 'Financial Services') {
    const endDatesOfQuarters = [
      new Date(sDate.getFullYear(), 2, 31),
      new Date(sDate.getFullYear(), 5, 30),
      new Date(sDate.getFullYear(), 8, 30),
      new Date(sDate.getFullYear(), 11, 31)
    ];

    for (const qEnd of endDatesOfQuarters) {
      let count = 0;
      let cur = new Date(qEnd);
      const blackoutDays = [];
      while (count < 5) {
        if (cur.getDay() !== 0 && cur.getDay() !== 6) {
          blackoutDays.push(new Date(cur));
          count++;
        }
        cur.setDate(cur.getDate() - 1);
      }
      
      const isBlackout = blackoutDays.some(bDay => {
        const checkDay = new Date(bDay);
        return datesOverlap(startVal, endVal, checkDay, checkDay);
      });

      if (isBlackout) {
        renderRuleNotice('error', 'SOX Compliance Conflict: Audits block scheduling requests during financial closing periods.');
        return;
      }
    }

    if (reqDays < 10) {
      renderRuleNotice('warning', 'Regulatory Warning: Standard financial rules require taking a continuous 10-day block leave.');
      return;
    }
  }

  renderRuleNotice('info', `Valid Request: Evaluated ${reqDays} business days. No severe blackout flags detected.`);
}

function renderRuleNotice(type, text) {
  const icon = type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : '✅');
  ruleWarnPane.innerHTML = `
    <div class="rule-alert ${type === 'error' ? 'warning' : (type === 'warning' ? 'warning' : 'info')}">
      <span class="rule-alert-icon">${icon}</span>
      <div class="rule-alert-content">${text}</div>
    </div>
  `;
}

// -------------------------------------------------------------
// HELPER MATH
// -------------------------------------------------------------

function calculateBusinessDays(start, end) {
  let count = 0;
  let cur = new Date(start.getTime());
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function datesOverlap(start1, end1, start2, end2) {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);
  return s1 <= e2 && s2 <= e1;
}

// -------------------------------------------------------------
// DB INSPECTOR HIGH-FIDELITY HTML RENDERER
// -------------------------------------------------------------

function renderDBInspectors() {
  if (!dbInspectorTableWrapper) return;
  
  let html = '';
  
  if (activeTableTab === 'employees') {
    html = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Sector</th>
            <th>Country</th>
            <th>Dept ID</th>
            <th>Role</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          ${state.employees.map(e => `
            <tr>
              <td><code>${e.id}</code></td>
              <td><strong>${e.name}</strong></td>
              <td><span class="badge badge-sector">${e.sector}</span></td>
              <td><span class="badge badge-country">ISO-${e.country}</span></td>
              <td><code>${e.department_id || 'NULL'}</code></td>
              <td>${e.role}</td>
              <td><a href="mailto:${e.email}" style="color:var(--primary); text-decoration:none;">${e.email}</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (activeTableTab === 'accrual_balances') {
    html = `
      <table>
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Year</th>
            <th>Base Days</th>
            <th>Accrued Days</th>
            <th>Used Days</th>
            <th>Rollover Days</th>
            <th>Net Available</th>
          </tr>
        </thead>
        <tbody>
          ${state.accrualBalances.map(b => {
            const net = (b.accrued_days + b.rollover_days) - b.used_days;
            return `
              <tr>
                <td><code>${b.employee_id}</code></td>
                <td>${b.year}</td>
                <td>${b.base_days}</td>
                <td>${b.accrued_days}</td>
                <td>${b.used_days}</td>
                <td>${b.rollover_days}</td>
                <td><strong style="color:var(--success);">${net}</strong></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (activeTableTab === 'departments') {
    html = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Sector</th>
            <th>Head ID</th>
            <th>Total Staff</th>
          </tr>
        </thead>
        <tbody>
          ${state.departments.map(d => `
            <tr>
              <td><code>${d.id}</code></td>
              <td><strong>${d.name}</strong></td>
              <td><span class="badge badge-sector">${d.sector}</span></td>
              <td><code>${d.head_id}</code></td>
              <td>${d.total_staff}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (activeTableTab === 'workflows') {
    html = `
      <table>
        <thead>
          <tr>
            <th>Req ID</th>
            <th>Employee</th>
            <th>Sector</th>
            <th>Dates Requested</th>
            <th>Days</th>
            <th>Status</th>
            <th>Next Step</th>
          </tr>
        </thead>
        <tbody>
          ${state.workflows.map(w => {
            let statusClass = 'badge-pending';
            if (w.status === 'approved') statusClass = 'badge-approved';
            if (w.status === 'rejected') statusClass = 'badge-rejected';
            return `
              <tr>
                <td><code>${w.id}</code></td>
                <td><strong>${w.employee_name}</strong></td>
                <td><span class="badge badge-sector">${w.sector}</span></td>
                <td>${w.start_date} to ${w.end_date}</td>
                <td>${w.days_requested}</td>
                <td><span class="status-badge ${statusClass}">${w.status.toUpperCase()}</span></td>
                <td><code>${w.current_step}</code></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (activeTableTab === 'notifications') {
    html = `
      <table>
        <thead>
          <tr>
            <th>Notif ID</th>
            <th>User ID</th>
            <th>Message</th>
            <th>Read</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody>
          ${state.notifications.map(n => `
            <tr style="${n.read ? 'opacity: 0.6;' : 'font-weight: 600;'}">
              <td><code>${n.id}</code></td>
              <td><code>${n.user_id}</code></td>
              <td>${n.message}</td>
              <td><span class="badge ${n.read ? 'badge-sector' : 'badge-approved'}">${n.read ? 'READ' : 'UNREAD'}</span></td>
              <td>${new Date(n.created_at).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  dbInspectorTableWrapper.innerHTML = html;
}

// -------------------------------------------------------------
// NOTIFICATIONS & TOASTS
// -------------------------------------------------------------

function showToast(type, text) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 4000);
}

function clearNotifications() {
  state.notifications.forEach(n => {
    if (n.user_id === currentEmployeeId) n.read = true;
  });
  renderNotificationsBadge();
  showToast('info', 'Active notifications marked as read.');
}

// -------------------------------------------------------------
// ANIMATION LOGIC FOR SVG NETWORK DIAGRAM
// -------------------------------------------------------------

function animatePacket(fromNode, toNode) {
  return new Promise((resolve) => {
    const packet = document.getElementById(`packet-${fromNode}-${toNode}-c`);
    const path = document.getElementById(`path-${fromNode}-${toNode}`);

    if (!packet || !path) {
      resolve();
      return;
    }

    packet.style.opacity = '1';
    
    const pathLen = path.getTotalLength();
    let duration = 800; // ms
    let startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percentage = Math.min(progress / duration, 1);

      const currentPoint = path.getPointAtLength(percentage * pathLen);
      packet.setAttribute('cx', currentPoint.x);
      packet.setAttribute('cy', currentPoint.y);

      if (percentage < 1) {
        requestAnimationFrame(step);
      } else {
        packet.style.opacity = '0';
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}
