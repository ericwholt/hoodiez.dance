// Stripe webhook → updates the existing Google Sheet row (created by /api/checkout)
// with payment status, payment intent, amount, and paid-at timestamp.
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

// Column layout must stay in sync with api/checkout.js SHEET_HEADERS
const COL_REGISTRATION_ID = 'B';
const COL_STATUS = 'R';
const COL_PAYMENT_ID = 'S';
const COL_AMOUNT = 'T';
const COL_PAID_AT = 'U';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function findRowByRegistrationId(sheets, sheetId, registrationId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `Sheet1!${COL_REGISTRATION_ID}:${COL_REGISTRATION_ID}`,
  });
  const rows = result.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === registrationId) {
      return i + 1; // 1-indexed sheet row
    }
  }
  return -1;
}

async function markPaid({ registrationId, paymentIntent, amount, paidAt }) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const rowIndex = await findRowByRegistrationId(sheets, sheetId, registrationId);
  if (rowIndex === -1) {
    console.error('Webhook: registrationId not found in sheet:', registrationId);
    return false;
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Sheet1!${COL_STATUS}${rowIndex}`, values: [['paid']] },
        { range: `Sheet1!${COL_PAYMENT_ID}${rowIndex}`, values: [[paymentIntent]] },
        { range: `Sheet1!${COL_AMOUNT}${rowIndex}`, values: [[amount]] },
        { range: `Sheet1!${COL_PAID_AT}${rowIndex}`, values: [[paidAt]] },
      ],
    },
  });
  return true;
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
    const registrationId = (session.metadata || {}).registrationId;
    if (!registrationId) {
      console.error('Webhook: session has no registrationId metadata');
      return res.status(200).json({ received: true });
    }

    try {
      await markPaid({
        registrationId,
        paymentIntent: session.payment_intent || '',
        amount: (session.amount_total / 100).toFixed(2),
        paidAt: new Date().toISOString(),
      });
      console.log('Registration marked paid:', registrationId);
    } catch (err) {
      console.error('Failed to mark registration paid:', err);
    }
  }

  res.status(200).json({ received: true });
};
