// Requires STRIPE_SECRET_KEY environment variable set in Vercel project settings
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const REQUIRED_FIELDS = [
  'dancerFirstName', 'dancerLastName', 'dancerAge',
  'emergencyFirstName', 'emergencyLastName', 'emergencyRelationship',
  'email', 'phone',
  'liabilityAgreed', 'medicalAgreed', 'photoAgreed', 'agreedAt'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hoodiez.dance');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    for (const field of REQUIRED_FIELDS) {
      if (!body[field] && body[field] !== 0) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    if (!body.liabilityAgreed || !body.medicalAgreed || !body.photoAgreed) {
      return res.status(400).json({ error: 'All waivers must be agreed to' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: body.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Golden/Huntrix Dance Class',
              description: 'Beginner K-pop Dance Class — April 18, 2026 — Expressions Dance Academy',
            },
            unit_amount: 1500,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://hoodiez.dance/thanks.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://hoodiez.dance/#register',
      metadata: {
        dancerFirstName: body.dancerFirstName,
        dancerLastName: body.dancerLastName,
        dancerAge: String(body.dancerAge),
        emergencyFirstName: body.emergencyFirstName,
        emergencyLastName: body.emergencyLastName,
        emergencyRelationship: body.emergencyRelationship,
        phone: body.phone,
        liabilityAgreed: String(body.liabilityAgreed),
        medicalAgreed: String(body.medicalAgreed),
        photoAgreed: String(body.photoAgreed),
        agreedAt: body.agreedAt,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
