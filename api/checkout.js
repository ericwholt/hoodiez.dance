// Requires env vars set in Vercel:
//   STRIPE_SECRET_KEY
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID
const Stripe = require('stripe');
const crypto = require('crypto');
const { google } = require('googleapis');

const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SHEET_ID',
];

const REQUIRED_FIELDS = [
  'dancerFirstName', 'dancerLastName',
  'signerRole', 'signerFirstName', 'signerLastName', 'signerRelationship',
  'emergencyFirstName', 'emergencyLastName', 'emergencyRelationship', 'emergencyPhone',
  'email', 'phone',
  'liabilityAgreed', 'medicalAgreed', 'photoAgreed', 'agreedAt',
  'signature',
];

const SIGNATURE_CELL_PART_LENGTH = 45000;

const SHEET_HEADERS = [
  'Submitted At', 'Registration ID',
  'Dancer First Name', 'Dancer Last Name',
  'Signer First Name', 'Signer Last Name', 'Signer Relationship',
  'Email', 'Phone',
  'Emergency First Name', 'Emergency Last Name', 'Emergency Relationship', 'Emergency Phone',
  'Liability Agreed', 'Medical Agreed', 'Photo Agreed',
  'Signature (PNG data URL) Part 1',
  'Signature (PNG data URL) Part 2',
  'Status', 'Payment ID', 'Amount', 'Paid At',
];

// A1 letter for a 1-indexed column. SHEET_HEADERS currently fits within A:Z.
function colLetter(n) {
  return String.fromCharCode(64 + n);
}

function missingEnvVars() {
  return REQUIRED_ENV.filter((name) => !process.env[name]);
}

function getStripeClient() {
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

function splitSignature(signature) {
  return [
    signature.slice(0, SIGNATURE_CELL_PART_LENGTH),
    signature.slice(SIGNATURE_CELL_PART_LENGTH),
  ];
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

async function ensureHeaders(sheets, sheetId) {
  const range = `Sheet1!A1:${colLetter(SHEET_HEADERS.length)}1`;
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const existingHeaders = existing.data.values && existing.data.values[0] ? existing.data.values[0] : [];
  const headersMatch = SHEET_HEADERS.every((header, index) => existingHeaders[index] === header);
  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });
  }
}

async function appendRegistration(row) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  await ensureHeaders(sheets, sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `Sheet1!A:${colLetter(SHEET_HEADERS.length)}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

module.exports = async function handler(req, res) {
  const allowedOrigins = ['https://hoodiez.dance', 'https://www.hoodiez.dance'];
  const origin = allowedOrigins.includes(req.headers.origin) ? req.headers.origin : allowedOrigins[0];
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const missingEnv = missingEnvVars();
  if (missingEnv.length > 0) {
    console.error('Checkout configuration missing env vars:', missingEnv.join(', '));
    return res.status(503).json({ error: 'Checkout is temporarily unavailable' });
  }

  try {
    const body = req.body;

    // Honeypot: if this hidden field has a value, treat as bot
    if (body._hp) {
      return res.status(200).json({ url: 'https://hoodiez.dance/thanks.html' });
    }

    for (const field of REQUIRED_FIELDS) {
      if (!body[field] && body[field] !== 0) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    if (!body.liabilityAgreed || !body.medicalAgreed || !body.photoAgreed) {
      return res.status(400).json({ error: 'All waivers must be agreed to' });
    }

    if (typeof body.signature !== 'string' || !body.signature.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    if (body.signerRole !== 'self' && body.signerRole !== 'guardian') {
      return res.status(400).json({ error: 'Invalid signer role' });
    }

    const registrationId = crypto.randomUUID();
    const quantity = 1;
    const [signaturePart1, signaturePart2] = splitSignature(body.signature);

    // Write registration to Google Sheets BEFORE creating the Stripe session
    // so the signature (too large for Stripe metadata) and PII land in our sheet.
    // Status starts as "pending" and is updated by the webhook on payment success.
    const submittedAt = new Date().toISOString();
    await appendRegistration([
      submittedAt,
      registrationId,
      body.dancerFirstName,
      body.dancerLastName,
      body.signerFirstName,
      body.signerLastName,
      body.signerRelationship,
      body.email,
      body.phone,
      body.emergencyFirstName,
      body.emergencyLastName,
      body.emergencyRelationship,
      body.emergencyPhone,
      String(body.liabilityAgreed),
      String(body.medicalAgreed),
      String(body.photoAgreed),
      signaturePart1,
      signaturePart2,
      'pending',
      '',
      '',
      '',
    ]);

    const session = await getStripeClient().checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: body.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Mystery K-Pop Dance Class',
              description: 'Mystery K-Pop dance class with Hoodiez. Guess the song on Instagram for a chance to win a K-pop album. All levels, ages 13+.',
            },
            unit_amount: 1500,
          },
          quantity,
        },
      ],
      payment_intent_data: {
        description: 'Mystery K-Pop Dance Class | Thu, May 14, 2026, 7-8 PM | Moveir Dance Studio | 2485 Burlingame Ave SW, Wyoming, MI',
      },
      mode: 'payment',
      success_url: 'https://hoodiez.dance/thanks.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://hoodiez.dance/#register',
      // Only the registrationId is sent to Stripe; PII stays in our sheet.
      metadata: { registrationId },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
