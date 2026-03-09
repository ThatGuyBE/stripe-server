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

    const line_items = items.map((item) => {
      if (!item.title || !item.price || !item.quantity) {
        throw new Error('Elk item moet title, price en quantity hebben.');
      }

      // Producttitel + variantnaam samen tonen in Stripe Checkout
      const productName = item.variantTitle
        ? `${item.title} - ${item.variantTitle}`
        : item.title;

      // Optionele beschrijving onder de titel
      const productDescription = item.optionSummary
        ? String(item.optionSummary)
        : '';

      // Zorg dat de image-url absoluut is
      let imageUrl = '';
      if (item.image) {
        imageUrl = String(item.image).startsWith('//')
          ? `https:${item.image}`
          : String(item.image);
      }

      return {
        quantity: Number(item.quantity),
        price_data: {
          currency: 'eur',
          unit_amount: Number(item.price), // prijs in centen
          product_data: {
            name: productName,
            description: productDescription,
            images: imageUrl ? [imageUrl] : [],
            metadata: {
              product_id: item.id ? String(item.id) : '',
              variant_id: item.variantId ? String(item.variantId) : '',
              product_url: item.url ? String(item.url) : '',
              sku: item.sku ? String(item.sku) : '',
              variant_title: item.variantTitle ? String(item.variantTitle) : ''
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
