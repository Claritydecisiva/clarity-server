require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const Stripe = require("stripe");

const app = express();

// Para endpoints normales (JSON)
app.use(bodyParser.json());

// Rutas simples de comprobación
app.get("/", (req, res) => {
  res.send("Servidor Clarity funcionando correctamente");
});

app.get("/prueba", (req, res) => {
  res.json({ ok: true, ruta: "/prueba", msg: "Prueba OK" });
});

app.get("/test", (req, res) => {
  res.json({ ok: true, ruta: "/test", msg: "Test OK" });
});

// INTEGRACIÓN CON STRIPE: cliente
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "");

// Crear PaymentIntent (ya tenías esto)
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({ amount, currency });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error al crear PaymentIntent:", error);
    res.status(500).json({ error: error.message });
  }
});

/*
  Webhook básico:
  - Este endpoint responde OK para depuración.
  - Si quieres usar el webhook de Stripe en producción debes usar
    express.raw({type: 'application/json'}) y stripe.webhooks.constructEvent.
*/
app.post("/webhook", (req, res) => {
  // sencillo: solo devuelve OK; para Stripe lo convertirás a raw más adelante
  console.log("Webhook recibido:", req.headers["content-type"]);
  res.status(200).send("webhook recibido");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Clarity iniciado en el puerto ${PORT}`);
});
