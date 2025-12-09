/**
 * index.js
 * Servidor Express para:
 *  - Crear sesiones Stripe Checkout (one-time & subscriptions)
 *  - Recibir webhook de Stripe (events: checkout.session.completed, invoice.payment_succeeded, customer.subscription.updated, etc.)
 *  - Crear ordenes PayPal (basic flow)
 *
 * NOTAS:
 *  - Reemplaza la "persistence" en memoria por tu base de datos (usuarios, suscripciones, orders).
 *  - Configura correctamente los webhooks en tu panel de Stripe y PayPal.
 *
 * Env vars required:
 *  - PORT (optional, default 3000)
 *  - STRIPE_SECRET_KEY
 *  - STRIPE_WEBHOOK_SECRET
 *  - PAYPAL_CLIENT_ID
 *  - PAYPAL_CLIENT_SECRET
 *  - BASE_URL (ej: https://tu-dominio.com) -> usado para return/cancel URLs
 */

import express from "express";
import dotenv from "dotenv";
import Stripe from "stripe";
import bodyParser from "body-parser";
import rawBody from "raw-body";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();

const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-11-15" });
const app = express();

// ---------- Simple in-memory "DB" (replace with real DB) ----------
/** Estructura mínima:
 * users: { [userId]: { email, stripeCustomerId, subscriptionId, subscriptionStatus } }
 * orders: { [orderId]: {...} }
 */
const users = new Map();
const orders = new Map();

// ---------- PayPal environment ----------
function paypalClient() {
  const environment = new paypal.core.SandboxEnvironment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  );
  return new paypal.core.PayPalHttpClient(environment);
}

// ---------- Middlewares ----------
app.use(express.json({
  verify: (req, res, buf) => {
    // keep raw body for Stripe webhook verification
    (req as any).rawBody = buf;
  }
}));

// For non-webhook routes we can also accept urlencoded if needed
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- Helpers ----------
function ensureUser(userId, email) {
  if (!users.has(userId)) {
    users.set(userId, {
      email: email || null,
      stripeCustomerId: null,
      subscriptionId: null,
      subscriptionStatus: null
    });
  }
  return users.get(userId);
}

// ---------- Routes ----------

/**
 * Create a Stripe Checkout session
 * Expects JSON:
 * {
 *   userId: "manuel123",
 *   priceId: "price_ABC",         // Stripe Price ID (for subscriptions or one-time)
 *   mode: "subscription" | "payment",
 *   success_url?: "...",
 *   cancel_url?: "..."
 * }
 */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { userId, email, priceId, mode = "subscription", success_url, cancel_url } = req.body;
    if (!priceId) return res.status(400).json({ error: "priceId is required" });

    // Ensure user exists in our storage
    const user = ensureUser(userId || `anon_${Date.now()}`, email);

    // Create or reuse Stripe customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email || email,
        metadata: { userId }
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      payment_method_types: ["card"],
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      // Set whatever you need for success/cancel
      success_url: success_url || `${process.env.BASE_URL || "http://localhost:3000"}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${process.env.BASE_URL || "http://localhost:3000"}/cancel`
    });

    // Optional: save a record of the order
    orders.set(session.id, { provider: "stripe", sessionId: session.id, userId, status: "created" });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session error", err);
    return res.status(500).json({ error: "internal_error", details: String(err) });
  }
});

/**
 * Create a PayPal Order (returns approval url for client)
 * Expects JSON:
 * {
 *   userId: "manuel123",
 *   amount: "19.99",
 *   currency: "EUR",
 *   description: "Compra ejemplo",
 *   intent: "CAPTURE" // typically CAPTURE
 * }
 */
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { userId, amount, currency = "EUR", description } = req.body;
    if (!amount) return res.status(400).json({ error: "amount required" });

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: String(amount)
          },
          description: description || undefined
        }
      ],
      application_context: {
        brand_name: "Tu Marca",
        return_url: `${process.env.BASE_URL}/paypal-success`,
        cancel_url: `${process.env.BASE_URL}/paypal-cancel`
      }
    });

    const client = paypalClient();
    const response = await client.execute(request);
    const order = response.result;

    // Save minimal order record
    orders.set(order.id, { provider: "paypal", orderId: order.id, userId, status: order.status });

    // Find approval link
    const approval = order.links.find(l => l.rel === "approve");
    return res.json({ orderId: order.id, approvalUrl: approval?.href, raw: order });
  } catch (err) {
    console.error("create-paypal-order error", err);
    return res.status(500).json({ error: "paypal_error", details: String(err) });
  }
});

/**
 * Capture a PayPal order after buyer approval
 * POST { orderId: "..." }
 */
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, userId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const client = paypalClient();
    const capture = await client.execute(request);

    // Update order in our DB
    const existing = orders.get(orderId) || {};
    existing.status = capture.result.status;
    existing.capture = capture.result;
    orders.set(orderId, existing);

    // TODO: map capture to subscription / entitlement in your DB
    return res.json({ ok: true, capture: capture.result });
  } catch (err) {
    console.error("capture-paypal-order error", err);
    return res.status(500).json({ error: "capture_error", details: String(err) });
  }
});

/**
 * Endpoint to check user's subscription / entitlement
 * GET /subscription-status?userId=...
 *
 * NOTE: This is example: in production, query your DB and Stripe for latest.
 */
app.get("/subscription-status", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const user = users.get(String(userId));
    if (!user) return res.status(404).json({ error: "user_not_found" });

    // If you have subscriptionId, you can fetch from Stripe:
    if (user.subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
      user.subscriptionStatus = subscription.status;
    }

    return res.json({
      userId,
      subscriptionStatus: user.subscriptionStatus || "none",
      stripeCustomerId: user.stripeCustomerId || null
    });
  } catch (err) {
    console.error("subscription-status error", err);
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * Stripe Webhook endpoint
 * Stripe requires the raw body to validate signature.
 *
 * Configure your Stripe dashboard webhook to point to: /webhook
 */
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("Stripe webhook secret not configured. Skipping verification (NOT recommended).");
  }

  let event;
  try {
    // Use the raw body stored earlier for verification
    const raw = (req as any).rawBody || rawBody(req);
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
    } else {
      // If not configured, parse JSON (less secure) — for dev only
      event = req.body;
    }
  } catch (err) {
    console.error("Webhook signature verification failed.", err);
    return res.status(400).send(`Webhook Error: ${err.message || err}`);
  }

  // Handle events
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // session.customer is the Stripe customer id
        // session.mode indicates "subscription" or "payment"
        console.log("Checkout session completed:", session.id);

        // Save to orders DB
        orders.set(session.id, { provider: "stripe", sessionId: session.id, userId: session.metadata?.userId || null, status: "completed" });

        // If subscription, attach subscription id to user (in your DB)
        if (session.subscription) {
          // Find user by stripeCustomerId:
          const custId = session.customer;
          for (const [uid, u] of users.entries()) {
            if (u.stripeCustomerId === custId) {
              u.subscriptionId = session.subscription;
              u.subscriptionStatus = "active";
              users.set(uid, u);
              break;
            }
          }
        }

        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        console.log("Invoice paid:", invoice.id);
        // Update subscription/payment state in DB if needed
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.created": {
        const subscription = event.data.object;
        console.log("Subscription event:", event.type, subscription.id);
        // Map subscription to your user DB using subscription.customer
        for (const [uid, u] of users.entries()) {
          if (u.stripeCustomerId === subscription.customer) {
            u.subscriptionId = subscription.id;
            u.subscriptionStatus = subscription.status;
            users.set(uid, u);
            break;
          }
        }
        break;
      }
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error handling webhook event", err);
    res.status(500).send("Server error");
  }
});

/**
 * (Optional) Basic PayPal webhook handler stub
 * NOTE: For production you MUST verify webhook authenticity using PayPal's verification API.
 */
app.post("/paypal-webhook", async (req, res) => {
  // TODO: Verify the webhook signature with PayPal. For now, just log and accept.
  console.log("PayPal webhook body:", req.body);
  // Example: capture completed => grant access in your DB
  res.json({ ok: true });
});

// Health check
app.get("/", (req, res) => {
  res.send("Payments service running");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (PORT ${PORT})`);
  console.log("Make sure STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set.");
});

