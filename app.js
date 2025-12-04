// app.js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const COMMISSION_RATE = 0.03;   // 3%
const PLATFORM_FEE = 0.99;      // flat
const GST_RATE = 0.09;          // 9%
const MIN_PRINCIPAL = 10;       // minimum $10

// FX rates (example)
const FX_RATES = {
  SGD: 1,
  USD: 0.75,
  BTN: 61,
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ----- /api/calc -----
app.post("/api/calc", (req, res) => {
  const { principal, marketValue } = req.body;
  const P = parseFloat(principal);
  const MV = parseFloat(marketValue);

  if (isNaN(P) || isNaN(MV) || P <= 0 || MV <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "Please enter valid positive numbers." });
  }

  if (P < MIN_PRINCIPAL) {
    return res.status(400).json({
      ok: false,
      message: `Minimum principal is ${MIN_PRINCIPAL.toFixed(2)}.`,
    });
  }

  const gstAmount = PLATFORM_FEE * GST_RATE;
  const totalFixedFee = PLATFORM_FEE + gstAmount;
  const commissionAmount = P * COMMISSION_RATE;

  const amountForCrypto = P - commissionAmount - totalFixedFee;
  if (amountForCrypto <= 0) {
    return res.status(400).json({
      ok: false,
      message:
        "Fees are higher than the principal. Increase the principal amount.",
    });
  }

  const coins = amountForCrypto / MV;
  const totalCharged = P + commissionAmount;

  res.json({
    ok: true,
    data: {
      principal: P,
      marketValue: MV,
      commissionRate: COMMISSION_RATE,
      commissionAmount,
      platformFee: PLATFORM_FEE,
      gstAmount,
      totalFixedFee,
      amountForCrypto,
      coins,
      totalCharged,
      minPrincipal: MIN_PRINCIPAL,
    },
  });
});

// ----- /api/convert -----
app.post("/api/convert", (req, res) => {
  const { from, to, amount } = req.body;
  const amt = parseFloat(amount);

  if (isNaN(amt) || amt <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "Please enter a valid amount." });
  }

  if (!FX_RATES[from] || !FX_RATES[to]) {
    return res.status(400).json({
      ok: false,
      message: "Unsupported currency. Use SGD, USD or BTN.",
    });
  }

  const amountInSgd = amt / FX_RATES[from];
  const converted = amountInSgd * FX_RATES[to];
  const rate = FX_RATES[to] / FX_RATES[from];

  res.json({
    ok: true,
    data: {
      from,
      to,
      amount: amt,
      converted,
      rate,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
