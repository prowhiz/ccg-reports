exports.handler = async function (event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ status: 'error', message: 'Method not allowed' }) };
  }

  const SHEETS_URL = process.env.SHEETS_URL;
  if (!SHEETS_URL) {
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Server not configured' }) };
  }

  // Parse and validate payload
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid JSON' }) };
  }

  const { department, date, rows } = payload;

  if (!department || typeof department !== 'string' || department.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid department' }) };
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid date format' }) };
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid rows' }) };
  }

  const ALLOWED_ACTIVITIES = ['Midnight Prayer', 'Mid-day Prayer', 'Bible Reading', 'Reflection', 'Confessions', 'Word Tape'];

  for (const row of rows) {
    if (!row.name || typeof row.name !== 'string' || row.name.length > 100) {
      return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid member name in row' }) };
    }
    for (const act of ALLOWED_ACTIVITIES) {
      if (typeof row[act] !== 'boolean') {
        return { statusCode: 400, body: JSON.stringify({ status: 'error', message: `Invalid value for activity: ${act}` }) };
      }
    }
  }

  // Forward validated payload to Google Apps Script
  try {
    const response = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department, date, rows }),
    });

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { status: 'error', message: text }; }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ status: 'error', message: 'Could not reach Google Sheets: ' + err.message }),
    };
  }
};
