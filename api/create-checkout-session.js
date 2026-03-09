const Stripe = require('stripe');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
@@ -27,26 +26,49 @@
      quantity: item.quantity,
      price_data: {
        currency: 'eur',

        product_data: {
          name: item.title,
        },
        unit_amount: item.price,
      },









    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact', 'ideal'],
      line_items,














      success_url:
        'https://maisondanvers.nl/pages/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://maisondanvers.nl/cart',
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: error.message });
  }
};
