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

// INTEGRACIÓN CON STRIPE
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "");

// Crear PaymentIntent
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error al crear PaymentIntent:", error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook básico (para pruebas iniciales)
app.post("/webhook", (req, res) => {
  console.log("Webhook recibido");
  res.status(200).send("webhook recibido");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Clarity iniciado en el puerto ${PORT}`);
});

