const express = require('express');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 8080;

let activeRegion = process.env.SERVICE_REGION || 'us-central1';

// Classroom Guardrails: Track active database connection clients created without release to simulate connection limit exhaustion
global.__dbActiveConnections = global.__dbActiveConnections || 0;
const MAX_DB_CLIENTS = 4; // Low cap so students detect Fault 2 after 4 requests

// Helper to simulate and detect Fault 1 (Regional routing misconfiguration across the Atlantic)
async function checkAndInjectRegionalRoutingDelay(req, res) {
  const dbReadHost = process.env.DB_READ_HOST || 'read-db.hr-vacation.internal';
  const currentRegion = activeRegion || process.env.SERVICE_REGION || 'us-central1';

  // If running in europe-west1 but DB_READ_HOST points to us-central1 (write-db or read-db-us)
  if (currentRegion === 'europe-west1' && (dbReadHost.includes('write-db') || dbReadHost.includes('-us'))) {
    const delayMs = 842;
    console.error(`[WARN] [FAULT 1 DETECTED - REGIONAL ROUTING MISCONFIGURATION]`);
    console.error(`  Service Region: ${currentRegion}`);
    console.error(`  Target DB Read Host: ${dbReadHost} (Region: us-central1)`);
    console.error(`  Impact: Downstream read request forced across the Atlantic! Simulated cross-region propagation delay: ${delayMs}ms added to response latency (Target SLA: < 50ms).`);
    console.error(`  Fix: Update Cloud Run env var DB_READ_HOST to local European replica (read-db-eu.hr-vacation.internal).`);

    res.setHeader('X-Region-Routing-Status', 'CROSS_ATLANTIC_HOP_DETECTED');
    res.setHeader('X-Query-Latency-Ms', String(delayMs));
    await new Promise(resolve => setTimeout(resolve, delayMs));
  } else if (currentRegion === 'europe-west1' && dbReadHost.includes('-eu')) {
    const delayMs = 14;
    console.log(`[INFO] [REGIONAL ROUTING OPTIMIZED]`);
    console.log(`  Service Region: ${currentRegion}`);
    console.log(`  Target DB Read Host: ${dbReadHost} (Local European Replica)`);
    console.log(`  Impact: Local regional read execution. Latency: ${delayMs}ms (SLA met: < 50ms).`);

    res.setHeader('X-Region-Routing-Status', 'LOCAL_EUROPE_OPTIMIZED');
    res.setHeader('X-Query-Latency-Ms', String(delayMs));
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

function fetchServerRegion() {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const options = {
      hostname: 'metadata.google.internal',
      path: '/computeMetadata/v1/instance/region',
      method: 'GET',
      headers: {
        'Metadata-Flavor': 'Google'
      },
      timeout: 1000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const trimmed = data.trim();
          const parts = trimmed.split('/');
          const region = parts[parts.length - 1];
          if (region) {
            activeRegion = region;
            console.log(`GCP Metadata Server resolved region: ${activeRegion}`);
          }
        } else {
          console.log(`Local Dev Mode: Metadata Server returned status ${res.statusCode}. Falling back to default region: ${activeRegion}`);
        }
        safeResolve();
      });
    });

    req.on('error', (err) => {
      console.log(`Local Dev Mode: Socket error or metadata server unreachable. Falling back to default region: ${activeRegion}`);
      safeResolve();
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`Local Dev Mode: Metadata Server request timed out. Falling back to default region: ${activeRegion}`);
      safeResolve();
    });

    req.end();
  });
}

// Trigger region fetch at boot-time
fetchServerRegion();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// REAL ALLOYDB PostgreSQL CONNECTION CONFIGURATION
// -------------------------------------------------------------

function getDbConfig(isWrite = true) {
  const host = isWrite 
    ? (process.env.DB_WRITE_HOST || 'write-db.hr-vacation.internal')
    : (process.env.DB_READ_HOST || 'read-db.hr-vacation.internal');
  return {
    host,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'postgres',
    port: 5432
  };
}

let dbLogs = []; // SQL logs shown inside the dashboard UI console

async function initDB() {
  const config = getDbConfig(true);
  const initPool = new Pool(config);
  try {
    const client = await initPool.connect();
    try {
      console.log('Initializing AlloyDB database tables...');
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS departments (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100),
          sector VARCHAR(50),
          head_id VARCHAR(50),
          total_staff INT
        );

        CREATE TABLE IF NOT EXISTS employees (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100),
          sector VARCHAR(50),
          country VARCHAR(10),
          department_id VARCHAR(50) REFERENCES departments(id),
          role VARCHAR(100),
          manager_id VARCHAR(50),
          email VARCHAR(100)
        );

        CREATE TABLE IF NOT EXISTS accrual_balances (
          employee_id VARCHAR(50) PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
          year INT,
          base_days INT,
          accrued_days INT,
          used_days INT,
          rollover_days INT
        );

        CREATE TABLE IF NOT EXISTS workflows (
          id VARCHAR(50) PRIMARY KEY,
          employee_id VARCHAR(50) REFERENCES employees(id) ON DELETE CASCADE,
          employee_name VARCHAR(100),
          sector VARCHAR(50),
          country VARCHAR(10),
          start_date VARCHAR(20),
          end_date VARCHAR(20),
          days_requested INT,
          status VARCHAR(20),
          current_step VARCHAR(50),
          approval_chain TEXT[],
          reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id VARCHAR(50) PRIMARY KEY,
          user_id VARCHAR(50) REFERENCES employees(id) ON DELETE CASCADE,
          message TEXT,
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Seed tables if empty
      const empCount = await client.query('SELECT COUNT(*) FROM employees');
      if (parseInt(empCount.rows[0].count) === 0) {
        console.log('Seeding database tables with default values...');
        await seedDatabaseTables(client);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error during database initialization:', err);
  } finally {
    await initPool.end();
  }
}

async function seedDatabaseTables(client) {
  await client.query(`
    INSERT INTO departments (id, name, sector, head_id, total_staff) VALUES
    ('dept_retail_cs', 'Store Customer Service', 'Retail', 'emp_102', 5),
    ('dept_health_uc', 'Urgent Care Unit', 'Healthcare', 'emp_202', 4),
    ('dept_finance_rm', 'Risk Management & Audit', 'Financial Services', 'emp_302', 3)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO employees (id, name, sector, country, department_id, role, manager_id, email) VALUES
    ('emp_101', 'Alice Vance', 'Retail', 'US', 'dept_retail_cs', 'Sales Associate', 'emp_102', 'alice.vance@retail.corp'),
    ('emp_102', 'Bob Smith', 'Retail', 'US', 'dept_retail_cs', 'Store Manager', NULL, 'bob.smith@retail.corp'),
    ('emp_201', 'Dr. Clara Mendez', 'Healthcare', 'UK', 'dept_health_uc', 'Attending Physician', 'emp_202', 'c.mendez@health.corp'),
    ('emp_202', 'David Jones', 'Healthcare', 'UK', 'dept_health_uc', 'Clinical Director', NULL, 'david.jones@health.corp'),
    ('emp_301', 'Edward Chen', 'Financial Services', 'Japan', 'dept_finance_rm', 'Risk Analyst', 'emp_302', 'e.chen@finance.corp'),
    ('emp_302', 'Fiona Sato', 'Financial Services', 'Japan', 'dept_finance_rm', 'VP of Compliance', NULL, 'fiona.sato@finance.corp')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO accrual_balances (employee_id, year, base_days, accrued_days, used_days, rollover_days) VALUES
    ('emp_101', 2026, 15, 15, 3, 2),
    ('emp_102', 2026, 15, 15, 5, 0),
    ('emp_201', 2026, 20, 20, 8, 5),
    ('emp_202', 2026, 20, 20, 10, 4),
    ('emp_301', 2026, 25, 25, 12, 0),
    ('emp_302', 2026, 25, 25, 15, 0)
    ON CONFLICT (employee_id) DO NOTHING;

    INSERT INTO workflows (id, employee_id, employee_name, sector, country, start_date, end_date, days_requested, status, current_step, approval_chain, reason, created_at, updated_at) VALUES
    ('req_901', 'emp_101', 'Alice Vance', 'Retail', 'US', '2026-08-10', '2026-08-14', 5, 'approved', 'completed', ARRAY['emp_102'], 'Summer family trip', '2026-06-01T10:00:00Z', '2026-06-02T14:30:00Z'),
    ('req_902', 'emp_201', 'Dr. Clara Mendez', 'Healthcare', 'UK', '2026-10-12', '2026-10-16', 5, 'pending', 'manager_review', ARRAY['emp_202'], 'Medical conference rollover vacation', '2026-06-25T08:15:00Z', '2026-06-25T08:15:00Z')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO notifications (id, user_id, message, read, created_at) VALUES
    ('notif_001', 'emp_101', 'Your vacation request req_901 has been APPROVED by Bob Smith.', TRUE, '2026-06-02T14:30:00Z'),
    ('notif_002', 'emp_202', 'New pending vacation request req_902 received from Dr. Clara Mendez.', FALSE, '2026-06-25T08:15:00Z')
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function resetDatabase() {
  const config = getDbConfig(true);
  const resetPool = new Pool(config);
  try {
    const client = await resetPool.connect();
    try {
      console.log('Truncating tables and resetting database state...');
      await client.query('TRUNCATE workflows, notifications, accrual_balances, employees, departments CASCADE');
      await seedDatabaseTables(client);
      console.log('Database state reset successfully.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error during database reset:', err);
  } finally {
    await resetPool.end();
  }
}

// Helper to extract true client IP
function getClientIP(req) {
  let ip = req.headers['x-forwarded-for'];
  if (ip) {
    ip = ip.split(',')[0].trim();
  } else {
    ip = req.socket.remoteAddress;
  }
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    ip = '127.0.0.1';
  }
  return ip;
}

// Helper to log GCLB verification on incoming API requests
function logGCLBRequest(req, email) {
  const clientIP = getClientIP(req);
  logDBAction('gclb', `GCLB: Intercepted ${req.method} request to ${req.path}. Client IP: ${clientIP}. Region: ${activeRegion}.`);
  logDBAction('gclb', `GCLB: Forwarded authenticated session for user: ${email}.`);
}

// Global logger middleware
app.use((req, res, next) => {
  if (req.url.startsWith('/api/') && !req.url.startsWith('/api/state') && req.url !== '/api/reset') {
    let email = 'student@gcp-lab.internal';
    logGCLBRequest(req, email);
  }
  next();
});

// Helper to log SQL events
function logDBAction(type, message) {
  dbLogs.unshift({
    timestamp: new Date().toISOString(),
    type,
    message
  });
  if (dbLogs.length > 100) dbLogs.pop();
}

function datesOverlap(start1, end1, start2, end2) {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);
  return s1 <= e2 && s2 <= e1;
}

function calculateBusinessDays(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  let count = 0;
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// -------------------------------------------------------------
// BUSINESS RULES ENGINE
// -------------------------------------------------------------

function validateRules(employee, balance, dept, dbWorkflows, startDate, endDate, daysRequested) {
  const sDate = new Date(startDate);
  const eDate = new Date(endDate);
  
  if (sDate > eDate) {
    return { valid: false, message: 'Start date must be on or before end date.' };
  }

  if (!balance) {
    return { valid: false, message: 'No accrual profile found for employee.' };
  }
  
  const netAvailable = (balance.accrued_days + balance.rollover_days) - balance.used_days;
  if (daysRequested > netAvailable) {
    return { 
      valid: false, 
      message: `Insufficient accrued vacation balance. Requested: ${daysRequested} days, Available: ${netAvailable} days (Accrued: ${balance.accrued_days}, Rollover: ${balance.rollover_days}, Used: ${balance.used_days}).` 
    };
  }

  if (employee.sector === 'Retail') {
    const isBlackout = datesOverlap(startDate, endDate, `${sDate.getFullYear()}-11-15`, `${sDate.getFullYear()}-12-31`) ||
                      datesOverlap(startDate, endDate, `${sDate.getFullYear()}-01-01`, `${sDate.getFullYear()}-01-05`);
    
    if (isBlackout) {
      return { 
        valid: true, 
        warning: true,
        escalate: true,
        message: 'Holiday Blackout Window (Nov 15 - Jan 5): This request requires Clinical/Store VP double-authorization due to retail shopping volumes.' 
      };
    }
  }

  if (employee.sector === 'Healthcare') {
    const totalStaff = dept ? dept.total_staff : 4;
    const maxOffAllowed = Math.floor(totalStaff * 0.3);

    const overlappingRequests = dbWorkflows.filter(w => {
      if (w.status !== 'approved' && w.status !== 'pending') return false;
      return w.employee_id !== employee.id && datesOverlap(startDate, endDate, w.start_date, w.end_date);
    });

    if (overlappingRequests.length >= maxOffAllowed) {
      return {
        valid: false,
        message: `On-Call Coverage Alert: The department ${dept ? dept.name : 'Urgent Care'} cannot support additional concurrent time off. At most ${maxOffAllowed} team members can be off at once. Current overlap matches or exceeds limit (${overlappingRequests.length} off).`
      };
    }
  }

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
        return datesOverlap(startDate, endDate, checkDay, checkDay);
      });

      if (isBlackout) {
        return {
          valid: false,
          message: 'Compliance Blackout window: Financial regulations strictly prohibit scheduling time off during the final 5 business days of any fiscal quarter.'
        };
      }
    }

    if (daysRequested < 10) {
      return {
        valid: true,
        warning: true,
        message: 'Compliance Advisory: FINRA/SOX policy recommends taking at least 10 consecutive business days of block-leave annually. Your request is less than 10 days.'
      };
    }
  }

  return { valid: true };
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

app.get('/api/state', async (req, res) => {
  await checkAndInjectRegionalRoutingDelay(req, res);

  // PLANTED FAULT 2: Instantiating a new Pool client inside the request handler, and NEVER closing it!
  const config = getDbConfig(false); // Reads go to read host (Fault 1 targets this host)
  const pool = new Pool(config);

  global.__dbActiveConnections = (global.__dbActiveConnections || 0) + 1;
  console.log(`[DB Monitor] Active database client connections: ${global.__dbActiveConnections} / ${MAX_DB_CLIENTS} limit`);

  if (global.__dbActiveConnections >= MAX_DB_CLIENTS) {
    const errMsg = `AlloyDB connection pool limit exceeded: ${global.__dbActiveConnections} active unclosed connections from new Pool() inside request handler.`;
    console.error(`[FATAL] [FAULT 2 DETECTED - DB CONNECTION LEAK EXHAUSTION] Error: max number of connections reached (${errMsg})`);
    return res.status(500).json({
      error: `HTTP 500 Internal Server Error: AlloyDB max number of clients reached (Connection leak: new Pool() invoked per-request without client release)`,
      code: 'ERR_DB_CONNECTION_EXHAUSTED',
      active_connections: global.__dbActiveConnections,
      limit: MAX_DB_CLIENTS
    });
  }

  try {
    const client = await pool.connect();
    
    // BUG: We intentionally omit client.release() and pool.end() to cause the socket leak!

    const employeesRes = await client.query('SELECT * FROM employees ORDER BY id');
    const accrualBalancesRes = await client.query('SELECT * FROM accrual_balances');
    const departmentsRes = await client.query('SELECT * FROM departments');
    const workflowsRes = await client.query('SELECT * FROM workflows ORDER BY created_at DESC');
    const notificationsRes = await client.query('SELECT * FROM notifications ORDER BY created_at DESC');

    logDBAction('sql', 'SELECT * FROM employees; SELECT * FROM accrual_balances; SELECT * FROM departments; SELECT * FROM workflows; SELECT * FROM notifications;');

    res.json({
      employees: employeesRes.rows,
      accrualBalances: accrualBalancesRes.rows,
      departments: departmentsRes.rows,
      workflows: workflowsRes.rows,
      notifications: notificationsRes.rows,
      logs: dbLogs
    });
  } catch (err) {
    console.error('State API query failed:', err);
    res.status(500).json({ error: `State query failed: ${err.message}` });
  }
});

app.post('/api/reset', async (req, res) => {
  try {
    await resetDatabase();
    global.__dbActiveConnections = 0;
    logDBAction('system', 'Database and AlloyDB connection counters were manually reset to classroom default baseline.');
    res.json({ success: true, message: 'Simulation database and connection pools reset successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/requests', async (req, res) => {
  await checkAndInjectRegionalRoutingDelay(req, res);

  // PLANTED FAULT 2: Instantiating a new Pool client inside the request handler, and NEVER closing it!
  const config = getDbConfig(true); // Writes must go to primary
  const pool = new Pool(config);

  global.__dbActiveConnections = (global.__dbActiveConnections || 0) + 1;
  console.log(`[DB Monitor] Active database client connections: ${global.__dbActiveConnections} / ${MAX_DB_CLIENTS} limit`);

  if (global.__dbActiveConnections >= MAX_DB_CLIENTS) {
    const errMsg = `AlloyDB connection pool limit exceeded: ${global.__dbActiveConnections} active unclosed connections from new Pool() inside request handler.`;
    console.error(`[FATAL] [FAULT 2 DETECTED - DB CONNECTION LEAK EXHAUSTION] Error: max number of connections reached (${errMsg})`);
    return res.status(500).json({
      error: `HTTP 500 Internal Server Error: AlloyDB max number of clients reached (Connection leak: new Pool() invoked per-request without client release)`,
      code: 'ERR_DB_CONNECTION_EXHAUSTED',
      active_connections: global.__dbActiveConnections,
      limit: MAX_DB_CLIENTS
    });
  }

  const { employee_id, start_date, end_date, reason } = req.body;
  if (!employee_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required parameters: employee_id, start_date, end_date.' });
  }

  try {
    const client = await pool.connect();
    
    // BUG: We intentionally omit client.release() and pool.end() to cause the socket leak!

    const empRes = await client.query('SELECT * FROM employees WHERE id = $1', [employee_id]);
    const employee = empRes.rows[0];
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const balRes = await client.query('SELECT * FROM accrual_balances WHERE employee_id = $1', [employee_id]);
    const balance = balRes.rows[0];

    const deptRes = await client.query('SELECT * FROM departments WHERE id = $1', [employee.department_id]);
    const dept = deptRes.rows[0];

    const wfRes = await client.query('SELECT * FROM workflows');
    const dbWorkflows = wfRes.rows;

    const daysRequested = calculateBusinessDays(start_date, end_date);
    if (daysRequested <= 0) {
      return res.status(400).json({ error: 'Selected time range does not contain any business days (Mon-Fri).' });
    }

    const validation = validateRules(employee, balance, dept, dbWorkflows, start_date, end_date, daysRequested);
    if (!validation.valid) {
      logDBAction('system', `Rejected submission for ${employee.name}: Rule validation failed. Reason: ${validation.message}`);
      return res.status(422).json({ error: validation.message });
    }

    const requestId = 'req_' + Math.floor(100 + Math.random() * 900);
    const isEscalated = validation.escalate || false;
    const initialStatus = 'pending';
    const initialStep = isEscalated ? 'vp_review' : 'manager_review';
    const managerId = employee.manager_id || 'emp_302';
    const notifId = 'notif_' + Math.floor(1000 + Math.random() * 9000);
    const notifMsg = `New vacation request ${requestId} (${daysRequested} days) submitted by ${employee.name} (${employee.sector}).`;

    await client.query('BEGIN');

    const insertWfQuery = `
      INSERT INTO workflows (id, employee_id, employee_name, sector, country, start_date, end_date, days_requested, status, current_step, approval_chain, reason, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *
    `;
    const wfInsertRes = await client.query(insertWfQuery, [
      requestId, employee.id, employee.name, employee.sector, employee.country,
      start_date, end_date, daysRequested, initialStatus, initialStep,
      employee.manager_id ? [employee.manager_id] : [], reason || 'N/A'
    ]);

    await client.query(`
      INSERT INTO notifications (id, user_id, message, read, created_at)
      VALUES ($1, $2, $3, FALSE, NOW())
    `, [notifId, managerId, notifMsg]);

    await client.query('COMMIT');

    logDBAction('sql', `BEGIN TRANSACTION;\nINSERT INTO workflows (id: ${requestId});\nINSERT INTO notifications (id: ${notifId});\nCOMMIT;`);

    res.status(201).json({
      success: true,
      requestId,
      daysRequested,
      escalated: isEscalated,
      warning: validation.warning ? validation.message : null,
      request: wfInsertRes.rows[0]
    });
  } catch (err) {
    console.error('Request submission failed:', err);
    res.status(500).json({ error: `Submission failed: ${err.message}` });
  }
});

app.post('/api/requests/:id/action', async (req, res) => {
  await checkAndInjectRegionalRoutingDelay(req, res);

  // PLANTED FAULT 2: Instantiating a new Pool client inside the request handler, and NEVER closing it!
  const config = getDbConfig(true);
  const pool = new Pool(config);

  global.__dbActiveConnections = (global.__dbActiveConnections || 0) + 1;
  console.log(`[DB Monitor] Active database client connections: ${global.__dbActiveConnections} / ${MAX_DB_CLIENTS} limit`);

  if (global.__dbActiveConnections >= MAX_DB_CLIENTS) {
    const errMsg = `AlloyDB connection pool limit exceeded: ${global.__dbActiveConnections} active unclosed connections from new Pool() inside request handler.`;
    console.error(`[FATAL] [FAULT 2 DETECTED - DB CONNECTION LEAK EXHAUSTION] Error: max number of connections reached (${errMsg})`);
    return res.status(500).json({
      error: `HTTP 500 Internal Server Error: AlloyDB max number of clients reached (Connection leak: new Pool() invoked per-request without client release)`,
      code: 'ERR_DB_CONNECTION_EXHAUSTED',
      active_connections: global.__dbActiveConnections,
      limit: MAX_DB_CLIENTS
    });
  }

  const requestId = req.params.id;
  const { action, actor_id } = req.body;

  if (!action || !actor_id) {
    return res.status(400).json({ error: 'Missing action or actor_id.' });
  }

  try {
    const client = await pool.connect();

    // BUG: We intentionally omit client.release() and pool.end() to cause the socket leak!

    const wfRes = await client.query('SELECT * FROM workflows WHERE id = $1', [requestId]);
    const workflow = wfRes.rows[0];
    if (!workflow) {
      return res.status(404).json({ error: 'Vacation request workflow not found.' });
    }

    if (workflow.status !== 'pending') {
      return res.status(400).json({ error: 'Action can only be performed on pending workflows.' });
    }

    const actRes = await client.query('SELECT * FROM employees WHERE id = $1', [actor_id]);
    const actor = actRes.rows[0];
    if (!actor) {
      return res.status(404).json({ error: 'Actor employee profile not found.' });
    }

    const notifId = 'notif_' + Math.floor(1000 + Math.random() * 9000);
    const updatedStatus = action === 'approve' ? 'approved' : 'rejected';

    await client.query('BEGIN');

    const updateWfRes = await client.query(`
      UPDATE workflows 
      SET status = $1, current_step = 'completed', updated_at = NOW() 
      WHERE id = $2
      RETURNING *
    `, [updatedStatus, requestId]);

    if (action === 'approve') {
      const balRes = await client.query('SELECT * FROM accrual_balances WHERE employee_id = $1', [workflow.employee_id]);
      const balance = balRes.rows[0];
      if (balance) {
        await client.query(`
          UPDATE accrual_balances 
          SET used_days = used_days + $1 
          WHERE employee_id = $2 AND year = 2026
        `, [workflow.days_requested, workflow.employee_id]);
      }
    }

    const notifMsg = `Your vacation request ${requestId} (${workflow.days_requested} days) was ${updatedStatus.toUpperCase()} by ${actor.name}.`;
    await client.query(`
      INSERT INTO notifications (id, user_id, message, read, created_at)
      VALUES ($1, $2, $3, FALSE, NOW())
    `, [notifId, workflow.employee_id, notifMsg]);

    await client.query('COMMIT');

    logDBAction('sql', `BEGIN TRANSACTION;\nUPDATE workflows SET status = '${updatedStatus}' WHERE id = '${requestId}';\nCOMMIT;`);

    res.json({
      success: true,
      workflow: updateWfRes.rows[0]
    });
  } catch (err) {
    console.error('Request action execution failed:', err);
    res.status(500).json({ error: `Execution failed: ${err.message}` });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`HR Vacation Request Subsystem Server listening on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to initialize database on boot:', err);
    // fallback listener in case DB host is totally unreachable during initial offline tests
    app.listen(PORT, () => {
      console.log(`HR Vacation Request Subsystem Server listening (offline fallback) on port ${PORT}`);
    });
  });
}

module.exports = app;
