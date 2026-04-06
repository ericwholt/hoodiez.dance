// Verifies a Stripe checkout session is actually paid
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hoodiez.dance');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.status(400).json({ verified: false });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const verified = session.payment_status === 'paid';
    return res.status(200).json({ verified });
  } catch (err) {
    return res.status(400).json({ verified: false });
  }
};
