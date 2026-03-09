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

        const { items, email } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Geen geldige items ontvangen.' });
        }

        const line_items = items.map((item) => {
            const title = String(item.title || 'Product').trim();
            const color = String(item.color || '').trim();

            const details = Array.isArray(item.details)
                ? item.details.map((d) => String(d).trim()).filter(Boolean)
                : [];

            let productName = title;
            let description = undefined;

            if (color) {
                productName = `${title} - ${color}`;
            }

            if (details.length > 0) {
                description = details.join('\n');
            }

            return {
                quantity: Number(item.quantity || 1),
                price_data: {
                    currency: 'eur',
                    unit_amount: Number(item.price || 0),
                    product_data: {
                        name: productName,
                        ...(description ? { description } : {}),
                        metadata: {
                            product_id: String(item.id || ''),
                            variant_id: String(item.variant_id || ''),
                            sku: String(item.sku || ''),
                            color: color.slice(0, 500),
                            details: details.join(' | ').slice(0, 500)
                        }
                    }
                }
            };
        });

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card', 'bancontact', 'ideal'],
            line_items,
            customer_email: email || undefined,

            billing_address_collection: 'required',

            phone_number_collection: {
                enabled: true,
            },

            shipping_address_collection: {
                allowed_countries: ['NL', 'BE'],
            },

            metadata: {
                source: 'custom_checkout',
                item_count: String(items.length)
            },

            success_url:
                'https://maisondanvers.nl/pages/payment-success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'https://maisondanvers.nl/cart',
        });

        return res.status(200).json({ url: session.url });

    } catch (error) {
        console.error('Stripe error:', error);
        return res.status(500).json({
            error: error.message || 'Stripe checkout kon niet worden gestart.'
        });
    }
};
