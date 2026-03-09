const Stripe = require('stripe');

async function handler(req, res) {
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

      if (session.payment_status !== 'paid') {
        return res.status(200).json({ received: true, skipped: 'not_paid' });
      }

      console.log('Checkout session completed:', session.id);

      // Idempotency light: check of er al een order met deze Stripe session tag bestaat
      const existingOrder = await findShopifyOrderByStripeSession(session.id);
      if (existingOrder) {
        console.log('Shopify order bestaat al voor session:', session.id);
        return res.status(200).json({ received: true, skipped: 'already_processed' });
      }

      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ['data.price.product']
      });

      const shipping = session.shipping_details?.address || {};
      const customerDetails = session.customer_details || {};

      const shopifyLineItems = lineItems.data.map((item) => {
        const product = item.price?.product;
        const expandedProduct =
          product && typeof product !== 'string' ? product : null;

        const metadata = expandedProduct?.metadata || {};
        const title = item.description || expandedProduct?.name || 'Product';

        const variantIdRaw = String(metadata.variant_id || '').trim();
        const variantId = variantIdRaw
          ? (
              variantIdRaw.startsWith('gid://shopify/ProductVariant/')
                ? variantIdRaw
                : `gid://shopify/ProductVariant/${variantIdRaw}`
            )
          : '';

        if (variantId) {
          return {
            variantId,
            quantity: Number(item.quantity || 1)
          };
        }

        // fallback custom line item
        return {
          title,
          quantity: Number(item.quantity || 1),
          priceSet: {
            shopMoney: {
              amount: Number(
                (item.amount_total || 0) / Math.max(Number(item.quantity || 1), 1) / 100
              ).toFixed(2),
              currencyCode: String(item.currency || session.currency || 'eur').toUpperCase()
            }
          }
        };
      });

      const orderInput = {
        currency: String(session.currency || 'eur').toUpperCase(),
        email: customerDetails.email || undefined,
        financialStatus: 'PAID',
        lineItems: shopifyLineItems,
        shippingAddress: {
          firstName: extractFirstName(
            session.shipping_details?.name || customerDetails.name || ''
          ),
          lastName: extractLastName(
            session.shipping_details?.name || customerDetails.name || ''
          ),
          address1: shipping.line1 || '',
          address2: shipping.line2 || '',
          city: shipping.city || '',
          provinceCode: shipping.state || '',
          zip: shipping.postal_code || '',
          countryCode: shipping.country || '',
          phone: customerDetails.phone || ''
        },
        billingAddress: {
          firstName: extractFirstName(
            customerDetails.name || session.shipping_details?.name || ''
          ),
          lastName: extractLastName(
            customerDetails.name || session.shipping_details?.name || ''
          ),
          address1: customerDetails.address?.line1 || shipping.line1 || '',
          address2: customerDetails.address?.line2 || shipping.line2 || '',
          city: customerDetails.address?.city || shipping.city || '',
          provinceCode: customerDetails.address?.state || shipping.state || '',
          zip: customerDetails.address?.postal_code || shipping.postal_code || '',
          countryCode: customerDetails.address?.country || shipping.country || '',
          phone: customerDetails.phone || ''
        },
        transactions: [
          {
            kind: 'SALE',
            status: 'SUCCESS',
            amountSet: {
              shopMoney: {
                amount: Number((session.amount_total || 0) / 100).toFixed(2),
                currencyCode: String(session.currency || 'eur').toUpperCase()
              }
            }
          }
        ],
        sourceIdentifier: session.id,
        note: `Stripe session: ${session.id}`,
        tags: ['stripe', 'external-checkout']
      };
      const created = await shopifyGraphQL(
        `
          mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
            orderCreate(order: $order, options: $options) {
              order {
                id
                name
                displayFinancialStatus
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          order: orderInput,
          options: {
            sendReceipt: false,
            sendFulfillmentReceipt: false
          }
        }
      );

      const payload = created?.data?.orderCreate;
      const userErrors = payload?.userErrors || [];

      if (userErrors.length > 0) {
        console.error('Shopify orderCreate errors:', JSON.stringify(userErrors, null, 2));
        return res.status(500).json({
          error: 'Shopify orderCreate mislukt',
          details: userErrors
        });
      }

      console.log('Shopify order gemaakt:', payload.order);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook verwerking mislukt:', err);
    return res.status(500).json({
      error: err.message || 'Webhook verwerking mislukt.'
    });
  }
}

module.exports = handler;

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function shopifyGraphQL(query, variables) {
  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-10/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const json = await response.json();

  if (!response.ok || json.errors) {
    throw new Error(JSON.stringify(json.errors || json, null, 2));
  }

  return json;
}

async function findShopifyOrderByStripeSession(sessionId) {
  const result = await shopifyGraphQL(
    `
      query findOrder($query: String!) {
        orders(first: 1, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `,
    {
      query: `tag:stripe-session-${sessionId}`
    }
  );

  return result?.data?.orders?.edges?.[0]?.node || null;
}

function extractFirstName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return parts[0] || '';
}

function extractLastName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(1).join(' ');
}
