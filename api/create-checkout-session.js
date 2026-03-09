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
      return res.status(400).json({ error: 'Geen geldige items ontvangen.' });
    }

    const line_items = items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'eur',
        unit_amount: item.price, // in centen
        product_data: {
          name: item.title,

          // Foto tonen in Stripe Checkout
          images: item.image ? [item.image] : [],

          // Extra info bewaren voor later
          metadata: {
            product_id: String(item.id || ''),
            product_url: String(item.url || ''),
            sku: String(item.sku || '')
          }
        }
      }
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact', 'ideal'],
      line_items,

      // Laat Stripe verzendadres vragen
      shipping_address_collection: {
        allowed_countries: ['BE', 'NL']
      },

      // Laat telefoonnummer vragen
      phone_number_collection: {
        enabled: true
      },

      // Optioneel: klantgegevens bewaren
      customer_creation: 'always',

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
