// Stripe webhook → Google Sheets
// Env vars needed:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

// Disable Vercel's automatic body parsing so we can verify the Stripe signature
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function appendToSheet(row) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = process.env.GOOGLE_SHEET_ID;

  // Check if headers exist, add them if sheet is empty
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1:K1',
  });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1:K1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          'Timestamp',
          'Dancer First Name',
          'Dancer Last Name',
          'Dancer Age',
          'Emergency First Name',
          'Emergency Last Name',
          'Emergency Relationship',
          'Email',
          'Phone',
          'Payment ID',
          'Amount',
        ]],
      },
    });
  }

  // Append the registration row
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:K',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};

    const row = [
      new Date().toISOString(),
      meta.dancerFirstName || '',
      meta.dancerLastName || '',
      meta.dancerAge || '',
      meta.emergencyFirstName || '',
      meta.emergencyLastName || '',
      meta.emergencyRelationship || '',
      session.customer_email || '',
      meta.phone || '',
      session.payment_intent || '',
      (session.amount_total / 100).toFixed(2),
    ];

    try {
      await appendToSheet(row);
      console.log('Registration added to Google Sheet');
    } catch (err) {
      console.error('Failed to write to Google Sheet:', err);
    }
  }

  res.status(200).json({ received: true });
};
