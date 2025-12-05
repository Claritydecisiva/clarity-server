// index.js
require('dotenv').config();
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

app.use(express.static('public'));
app.use(express.json());

// Crear Checkout Session (Stripe)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { price = 2900, currency = 'eur', productName = 'Clarity Plan' } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency,
          product_data: { name: productName },
          unit_amount: price
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`
    });
    res.json({ id: session.id });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stripe Webhook
app.post('/webhook/stripe', bodyParser.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Pago completado (webhook):', session);
  }

  res.json({ received: true });
});

// PayPal: crear orden
app.post('/api/paypal/create-order', async (req, res) => {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE } = process.env;
  const base = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

  try {
    let r = await fetch(`${base}/v1/oauth2/token`, {
      method: 'post',
      body: 'grant_type=client_credentials',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const tokenJson = await r.json();
    const token = tokenJson.access_token;

    r = await fetch(`${base}/v2/checkout/orders`, {
      method: 'post',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'EUR', value: '29.00' } }]
      })
    });
    const order = await r.json();
    res.json(order);
  } catch (err) {
    console.error('paypal create-order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PayPal: capture
app.post('/api/paypal/capture-order', express.json(), async (req, res) => {
  const { orderID } = req.body;
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE } = process.env;
  const base = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

  try {
    let r = await fetch(`${base}/v1/oauth2/token`, {
      method: 'post',
      body: 'grant_type=client_credentials',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const tokenJson = await r.json();
    const token = tokenJson.access_token;

    r = await fetch(`${base}/v2/checkout/orders/${orderID}/capture`, {
      method: 'post',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const capture = await r.json();
    console.log('PayPal capture:', capture);
    res.json(capture);
  } catch (err) {
    console.error('paypal capture error:', err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
