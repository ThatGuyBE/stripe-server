const Stripe = require('stripe');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', 'https://maisondanvers.nl');
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

    const line_items = items.map((item) => {
      if (!item.title || item.price == null || item.quantity == null) {
        throw new Error('Elk item moet title, price en quantity hebben.');
      }

      return {
        quantity: item.quantity,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(item.price), // of *100 als price in euro staat
          product_data: {
            name: item.title,
            images: item.image ? [item.image] : [],
            metadata: {
              product_id: item.id ? String(item.id) : '',
              product_url: item.url ? String(item.url) : '',
              sku: item.sku ? String(item.sku) : ''
            }
          }
        }
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact', 'ideal'],
      line_items,
      shipping_address_collection: {
        allowed_countries: ['BE', 'NL']
      },
      phone_number_collection: {
        enabled: true
      },
      customer_creation: 'always',
      success_url:
        'https://maisondanvers.nl/pages/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://maisondanvers.nl/cart'
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: error.message });
  }
};
