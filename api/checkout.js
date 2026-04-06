// Requires STRIPE_SECRET_KEY environment variable set in Vercel project settings
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');

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

    // Honeypot check — if this hidden field has a value, it's a bot
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

    // Generate a registration ID to minimize PII stored in Stripe
    const registrationId = crypto.randomUUID();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: body.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'GOLDEN - HUNTR/X',
              description: 'Get ready to dance! Hoodiez is partnering with Expressions Dance Studio for a fun, high-energy class where you\'ll learn choreography to "Golden" from K-Pop Demon Hunters. This class will be taught by Nessa Maria, the choreographer and Isabella from the K-pop cover group Hoodiez, bringing their style, experience, and passion straight to the studio. Open to ages 7 and up, this is a beginners class that is perfect for K-pop fans and all dancers. Come ready to move, learn, and shine.',
            },
            unit_amount: 1500,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        description: 'GOLDEN - HUNTR/X Dance Class | Sat, April 18, 2026, 11 AM - 12 PM | Expressions Dance Academy | 6710 Division Ave S, Grand Rapids, MI 49548',
      },
      mode: 'payment',
      success_url: 'https://hoodiez.dance/thanks.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://hoodiez.dance/#register',
      metadata: {
        registrationId,
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
