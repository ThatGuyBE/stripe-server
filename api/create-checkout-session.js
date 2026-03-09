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

        const line_items = items.map((item) => ({
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

            // E-mail vooraf invullen indien beschikbaar
            customer_email: email || undefined,

            // Verplicht factuuradres tonen
            billing_address_collection: 'required',

            // Telefoonnummer vragen
            phone_number_collection: {
                enabled: true,
            },

            // Verzendadres vragen en alle landen toestaan
            shipping_address_collection: {
                allowed_countries: [
                    'AC','AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AT','AU','AW',
                    'AX','AZ','BA','BB','BD','BE','BF','BG','BH','BJ','BL','BM','BN','BO',
                    'BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CD','CF','CG','CH','CI',
                    'CK','CL','CM','CN','CO','CR','CV','CW','CY','CZ','DE','DJ','DK','DM',
                    'DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FO','FR',
                    'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR',
                    'GS','GT','GW','GY','HK','HN','HR','HT','HU','ID','IE','IL','IM','IN',
                    'IO','IQ','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN',
                    'KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV',
                    'MA','MC','MD','ME','MF','MG','MK','ML','MN','MO','MQ','MR','MS','MT',
                    'MU','MV','MW','MX','MY','MZ','NA','NC','NE','NG','NI','NL','NO','NP',
                    'NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR',
                    'PS','PT','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SE','SG',
                    'SH','SI','SJ','SK','SL','SM','SN','SO','SR','ST','SV','SX','SZ','TA',
                    'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV',
                    'TW','TZ','UA','UG','US','UY','UZ','VA','VC','VE','VG','VN','VU','WF',
                    'WS','XK','YE','YT','ZA','ZM','ZW'
                ],
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
