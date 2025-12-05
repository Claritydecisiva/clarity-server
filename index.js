require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const Stripe = require("stripe");

const app = express();
app.use(bodyParser.json());

// Inicializar Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Ruta básica para comprobar que el servidor funciona
app.get("/", (req, res) => {
  res.send("Servidor Clarity funcionando correctamente");
});

// Crear pago con Stripe
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error("Error al crear PaymentIntent:", error);
    res.status(500).json({ error: error.message });
  }
});

// Aquí más adelante añadiremos PayPal
// ...

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Clarity iniciado en el puerto ${PORT}`);
});

