exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ status: 'error', message: 'Method not allowed' }) };
  }

  const SHEETS_URL = process.env.SHEETS_URL;
  if (!SHEETS_URL) {
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Server not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid JSON' }) }; }

  const { department, hash, names } = payload;

  if (!department || typeof department !== 'string' || department.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid department' }) };
  }
  if (!hash || typeof hash !== 'string' || hash.length !== 64) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Unauthorized' }) };
  }
  if (!Array.isArray(names) || names.length === 0 || names.length > 50) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid names — must be a non-empty array of up to 50' }) };
  }
  for (const name of names) {
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return { statusCode: 400, body: JSON.stringify({ status: 'error', message: `Invalid name: "${name}"` }) };
    }
  }

  try {
    const res  = await fetch(SHEETS_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ action: 'addMembers', department, hash, names: names.map(n => n.trim()) }),
    });
    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { status: 'error', message: text }; }
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ status: 'error', message: 'Could not reach Google Sheets: ' + err.message }) };
  }
};
