<script>
  async function startStripeCheckout() {
    try {
      const item = {
        id: "123",
        variantId: "456",
        title: "Test product",
        variantTitle: "Default Title",
        optionSummary: "Test variant",
        price: 2995,
        quantity: 1,
        url: window.location.href,
        sku: "TEST-001"
      };

      const response = await fetch('https://stripe-serversdfq-6wj32huk1-thatguybes-projects.vercel.app/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ items: [item] })
      });

      const data = await response.json();

      console.log('STATUS:', response.status);
      console.log('RESPONSE:', data);

      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Stripe checkout kon niet worden gestart: ' + (data.error || 'onbekende fout'));
      }
    } catch (error) {
      console.error('Checkout fout:', error);
      alert('Stripe checkout kon niet worden gestart: ' + error.message);
    }
  }
</script>
