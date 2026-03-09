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
            const variantName = item.variant || item.variantName || '';
            const productName = variantName
                ? `${item.title} - ${variantName}`
                : item.title;

            return {
                quantity: item.quantity,
                price_data: {
                    currency: 'eur',
                    unit_amount: item.price, // prijs in centen
                    product_data: {
                        name: productName,
                        metadata: {
                            product_id: String(item.id || ''),
                            title: String(item.title || ''),
                            variant: String(variantName || ''),
                            sku: String(item.sku || ''),
                        },
                    },
                },
            };
        });

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card', 'bancontact', 'ideal'],
            line_items,

            customer_email: email || undefined,

            // naam tonen / laten invullen
            name_collection: {
                individual: {
                    enabled: true,
                },
            },

            // factuuradres verplicht
            billing_address_collection: 'required',

            // telefoonnummer tonen
            phone_number_collection: {
                enabled: true,
            },

            // verzendadres vragen, alleen NL en BE
            shipping_address_collection: {
                allowed_countries: ['NL', 'BE'],
            },

            // handig voor je eigen ordersysteem
            metadata: {
                source: 'custom_checkout',
                order_items: JSON.stringify(
                    items.map((item) => ({
                        id: item.id || '',
                        title: item.title || '',
                        variant: item.variant || item.variantName || '',
                        sku: item.sku || '',
                        quantity: item.quantity || 1,
                        price: item.price || 0,
                    }))
                ),
            },

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
