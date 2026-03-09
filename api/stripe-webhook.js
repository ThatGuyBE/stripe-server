const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = req.headers['stripe-signature'];

  let event;

  try {
    const rawBody = await getRawBody(req);

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ['data.price.product']
      });

      const order = {
        stripe_session_id: session.id,
        payment_status: session.payment_status,
        customer_email: session.customer_details?.email || '',
        customer_name: session.customer_details?.name || '',
        customer_phone: session.customer_details?.phone || '',
        shipping_name: session.shipping_details?.name || '',
        shipping_address: session.shipping_details?.address || null,
        items: lineItems.data.map((item) => {
          const product = item.price?.product;
          const expandedProduct =
            product && typeof product !== 'string' ? product : null;

          return {
            description: item.description || '',
            quantity: item.quantity || 0,
            amount_total: item.amount_total || 0,
            currency: item.currency || 'eur',
            image: expandedProduct?.images?.[0] || '',
            product_id: expandedProduct?.metadata?.product_id || '',
            product_url: expandedProduct?.metadata?.product_url || '',
            sku: expandedProduct?.metadata?.sku || ''
          };
        })
      };

      console.log('=== NIEUWE BESTELLING ===');
      console.log(JSON.stringify(order, null, 2));
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook verwerking mislukt:', err.message);
    return res.status(500).json({ error: 'Webhook verwerking mislukt.' });
  }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      resolve(data);
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}
