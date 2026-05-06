exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ status: 'error', message: 'Method not allowed' }) };
  }

  const SHEETS_URL = process.env.SHEETS_URL;
  if (!SHEETS_URL) {
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Server not configured' }) };
  }

  const department = event.queryStringParameters?.department?.trim();
  const hash       = event.queryStringParameters?.hash?.trim();

  if (!department || department.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid department' }) };
  }
  if (!hash || hash.length !== 64) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid hash' }) };
  }

  try {
    const url  = `${SHEETS_URL}?action=getHistory&department=${encodeURIComponent(department)}&hash=${encodeURIComponent(hash)}`;
    const res  = await fetch(url);
    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { status: 'error', message: 'Invalid response from Google Sheets' }; }
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ status: 'error', message: 'Could not reach Google Sheets: ' + err.message }) };
  }
};
