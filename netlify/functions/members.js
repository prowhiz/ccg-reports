exports.handler = async function (event) {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ status: 'error', message: 'Method not allowed' }),
    };
  }

  const SHEETS_URL = process.env.SHEETS_URL;
  if (!SHEETS_URL) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: 'Server not configured' }),
    };
  }

  const department = event.queryStringParameters?.department?.trim();
  if (!department || department.length > 100) {
    return {
      statusCode: 400,
      body: JSON.stringify({ status: 'error', message: 'Missing or invalid department parameter' }),
    };
  }

  // Forward to Google Apps Script as a GET request with action + department params
  try {
    const url = `${SHEETS_URL}?action=getMembers&department=${encodeURIComponent(department)}`;
    const response = await fetch(url);
    const text = await response.text();

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { status: 'error', message: 'Invalid response from Google Sheets' };
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        // Cache for 60 seconds — roster doesn't change mid-day
        'Cache-Control': 'public, max-age=60',
      },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({
        status: 'error',
        message: 'Could not reach Google Sheets: ' + err.message,
      }),
    };
  }
};
