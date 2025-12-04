// app.js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Fee config ----
const COMMISSION_RATE = 0.03; // 3%
const PLATFORM_FEE = 0.99;    // flat
const GST_RATE = 0.09;        // 9%
const MIN_PRINCIPAL = 10;     // $10 minimum

// ---- External APIs ----
const FX_API_BASE = "https://api.exchangerate.host";
const COINGECKO_SIMPLE_PRICE =
  "https://api.coingecko.com/api/v3/simple/price";

// Mapping friendly coin symbols -> CoinGecko IDs
const COINS = {
  usdt: { id: "tether" },
  eth:  { id: "ethereum" },
  usdc: { id: "usd-coin" },
  sol:  { id: "solana" }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ------------------
// Crypto calculator
// ------------------
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

// ------------------
// Live FX converter
// ------------------
app.post("/api/convert", async (req, res) => {
  try {
    const { from, to, amount } = req.body;
    const amt = parseFloat(amount);

    if (isNaN(amt) || amt <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Please enter a valid amount." });
    }

    if (!from || !to) {
      return res
        .status(400)
        .json({ ok: false, message: "Both 'from' and 'to' currencies are required." });
    }

    // Use exchangerate.host latest endpoint
    const url = `${FX_API_BASE}/latest?base=${encodeURIComponent(
      from
    )}&symbols=${encodeURIComponent(to)}`;

    const fxRes = await fetch(url);
    if (!fxRes.ok) {
      throw new Error("FX API error");
    }

    const fxData = await fxRes.json();
    const rate = fxData.rates && fxData.rates[to];

    if (!rate) {
      return res.status(400).json({
        ok: false,
        message: "Conversion pair not supported by FX API.",
      });
    }

    const converted = amt * rate;

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
  } catch (err) {
    console.error("FX convert error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch live FX rate.",
    });
  }
});

// Get latest FX snapshot for UI (SGD base, show USD & BTN)
app.get("/api/fx/latest", async (req, res) => {
  try {
    const base = "SGD";
    const symbols = "USD,BTN";
    const url = `${FX_API_BASE}/latest?base=${base}&symbols=${symbols}`;

    const fxRes = await fetch(url);
    if (!fxRes.ok) {
      throw new Error("FX API error");
    }

    const data = await fxRes.json();

    res.json({
      ok: true,
      data: {
        base: data.base,
        date: data.date,
        rates: data.rates,
      },
    });
  } catch (err) {
    console.error("FX latest error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load live FX rates.",
    });
  }
});

// ------------------------
// Live coin market values
// ------------------------
app.get("/api/coins/latest", async (req, res) => {
  try {
    const ids = Object.values(COINS)
      .map((c) => c.id)
      .join(",");
    const vs = "usd,sgd";

    const url = `${COINGECKO_SIMPLE_PRICE}?ids=${encodeURIComponent(
      ids
    )}&vs_currencies=${encodeURIComponent(vs)}`;

    const cgRes = await fetch(url);
    if (!cgRes.ok) {
      throw new Error("CoinGecko API error");
    }

    const raw = await cgRes.json();

    // Transform to keyed by symbol: { usdt: { usd: .., sgd: .. }, ... }
    const out = {};
    for (const [symbol, cfg] of Object.entries(COINS)) {
      const coinData = raw[cfg.id];
      if (coinData) {
        out[symbol] = {
          usd: coinData.usd,
          sgd: coinData.sgd,
        };
      }
    }

    res.json({
      ok: true,
      data: out,
    });
  } catch (err) {
    console.error("Coin prices error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load live coin prices.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
