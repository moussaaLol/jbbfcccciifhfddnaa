// A Vercel Serverless Function to create a Stripe PaymentIntent.
// This file should be placed in the 'api' directory at the root of your project.

// The Stripe Node.js library. It is automatically available in the Vercel environment.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Define a variable for the hardcoded product price.
// You should set this to whatever you're charging.
const HARDCODED_PRICE = 1699; // This is $10.00 in cents.

// This is the main function that handles incoming requests.
// It will be triggered when your front end makes a request to /api/create-payment-intent.
module.exports = async (req, res) => {
    // We only want to process POST requests for security.
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    // Use a try/catch block to handle any errors that occur during the process.
    try {
        // Create a PaymentIntent with the Stripe API.
        const paymentIntent = await stripe.paymentIntents.create({
            amount: HARDCODED_PRICE,
            currency: 'eur',
            // Add a description to help you identify this transaction later.
            description: 'NazAPI Premium Service',
        });

        // If the PaymentIntent is created successfully, send back its client secret.
        // The client secret is used on the front end to confirm the payment.
        res.status(200).json({
            clientSecret: paymentIntent.client_secret
        });

    } catch (error) {
        // If an error occurs, log it to the Vercel logs for debugging.
        console.error('Error creating PaymentIntent:', error);
        // Send a 500 status code and the error message to the front end.
        res.status(500).json({
            error: error.message
        });
    }
};
