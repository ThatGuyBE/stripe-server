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

      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ['data.price.product']
      });

      const shipping = session.shipping_details?.address || {};
      const billing = session.customer_details?.address || {};
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

        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitAmount = Number((item.amount_total || 0) / quantity / 100).toFixed(2);
        const currencyCode = String(item.currency || session.currency || 'eur').toUpperCase();

        const properties = [];

        if (metadata.color) {
          properties.push({
            name: 'Color',
            value: String(metadata.color)
          });
        }

        if (metadata.details) {
          properties.push({
            name: 'Details',
            value: String(metadata.details)
          });
        }

        if (metadata.product_id) {
          properties.push({
            name: 'Product ID',
            value: String(metadata.product_id)
          });
        }

        if (metadata.sku) {
          properties.push({
            name: 'SKU',
            value: String(metadata.sku)
          });
        }

        if (variantId) {
          return {
            variantId,
            quantity,
            priceSet: {
              shopMoney: {
                amount: unitAmount,
                currencyCode
              }
            },
            ...(properties.length ? { properties } : {})
          };
        }

        return {
          title,
          quantity,
          priceSet: {
            shopMoney: {
              amount: unitAmount,
              currencyCode
            }
          },
          ...(properties.length ? { properties } : {})
        };
      });

      const orderInput = {
        currency: String(session.currency || 'eur').toUpperCase(),
        email: customerDetails.email || undefined,
        financialStatus: 'PAID',
        sourceIdentifier: session.id,
        note: `Stripe session: ${session.id}`,
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
          address1: billing.line1 || shipping.line1 || '',
          address2: billing.line2 || shipping.line2 || '',
          city: billing.city || shipping.city || '',
          provinceCode: billing.state || shipping.state || '',
          zip: billing.postal_code || shipping.postal_code || '',
          countryCode: billing.country || shipping.country || '',
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

function extractFirstName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return parts[0] || '';
}

function extractLastName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(1).join(' ');
}
