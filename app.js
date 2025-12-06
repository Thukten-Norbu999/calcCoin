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
// OLD (no longer used for FX):
// const FX_API_BASE = "https://api.exchangerate.host";

// Your FX scraper API (Python on Render)
const FIOOG_BASE = "https://figoogapi.onrender.com";

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
// Helper: FX via FioogAPI
// ------------------

/**
 * Get FX rate from -> to using your FioogAPI.
 * Supported combos:
 *  - USD <-> BTN
 *  - USD <-> SGD
 *  - BTN <-> SGD
 */
async function getFxRateFromFioog(from, to) {
  const F = from.toUpperCase();
  const T = to.toUpperCase();

  if (F === T) return 1;

  // 1) Direct USD-based pairs via /quote
  if (F === "USD" && T === "BTN") {
    const res = await fetch(`${FIOOG_BASE}/quote/USD-BTN`);
    if (!res.ok) throw new Error("FioogAPI error for USD-BTN");
    const data = await res.json();
    return data.price; // BTN per 1 USD
  }

  if (F === "USD" && T === "SGD") {
    const res = await fetch(`${FIOOG_BASE}/quote/USD-SGD`);
    if (!res.ok) throw new Error("FioogAPI error for USD-SGD");
    const data = await res.json();
    return data.price; // SGD per 1 USD
  }

  // 2) Inverse of USD base pairs
  if (F === "BTN" && T === "USD") {
    const res = await fetch(`${FIOOG_BASE}/quote/USD-BTN`);
    if (!res.ok) throw new Error("FioogAPI error for USD-BTN");
    const data = await res.json();
    return 1 / data.price; // USD per 1 BTN
  }

  if (F === "SGD" && T === "USD") {
    const res = await fetch(`${FIOOG_BASE}/quote/USD-SGD`);
    if (!res.ok) throw new Error("FioogAPI error for USD-SGD");
    const data = await res.json();
    return 1 / data.price; // USD per 1 SGD
  }

  // 3) BTN <-> SGD via /fx cross-rate
  if ((F === "BTN" && T === "SGD") || (F === "SGD" && T === "BTN")) {
    const res = await fetch(`${FIOOG_BASE}/fx`);
    if (!res.ok) throw new Error("FioogAPI error for /fx");
    const data = await res.json();

    const btnSgd = data.pairs?.["BTN/SGD"]?.price; // SGD per 1 BTN
    if (typeof btnSgd !== "number" || isNaN(btnSgd)) {
      throw new Error("BTN/SGD rate missing in /fx");
    }

    if (F === "BTN" && T === "SGD") {
      return btnSgd; // SGD per 1 BTN
    } else {
      return 1 / btnSgd; // BTN per 1 SGD
    }
  }

  // If we reach here, the pair is not supported
  throw new Error(`FX pair ${from}/${to} not supported by FioogAPI`);
}

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
// Live FX converter (via FioogAPI)
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

    const rate = await getFxRateFromFioog(from, to);
    const converted = amt * rate;

    res.json({
      ok: true,
      data: {
        from,
        to,
        amount: amt,
        converted,
        rate,
        source: "FioogAPI (Google Finance scraper)"
      },
    });
  } catch (err) {
    console.error("FX convert error (FioogAPI):", err.message || err);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch live FX rate from FioogAPI.",
      error: err.message || String(err),
    });
  }
});

// Get latest FX snapshot for UI (SGD base, show USD & BTN) via FioogAPI
app.get("/api/fx/latest", async (req, res) => {
  try {
    // We'll treat SGD as base in the response, but FioogAPI is USD/SGD & BTN/SGD.
    const fxRes = await fetch(`${FIOOG_BASE}/fx`);
    if (!fxRes.ok) {
      throw new Error("FioogAPI /fx error");
    }
    const data = await fxRes.json();

    const usdSgd = data.pairs?.["USD/SGD"]?.price; // SGD per 1 USD
    const btnSgd = data.pairs?.["BTN/SGD"]?.price; // SGD per 1 BTN

    if (typeof usdSgd !== "number" || typeof btnSgd !== "number") {
      throw new Error("Missing USD/SGD or BTN/SGD in FioogAPI /fx response");
    }

    // We want base = SGD, so:
    //   1 SGD = (1 / usdSgd) USD
    //   1 SGD = (1 / btnSgd) BTN
    const rateUsd = 1 / usdSgd;
    const rateBtn = 1 / btnSgd;

    res.json({
      ok: true,
      data: {
        base: "SGD",
        // You could also include data.date if your API returns it
        rates: {
          USD: rateUsd,
          BTN: rateBtn,
        },
        source: "FioogAPI /fx"
      },
    });
  } catch (err) {
    console.error("FX latest error (FioogAPI):", err.message || err);
    res.status(500).json({
      ok: false,
      message: "Failed to load live FX rates from FioogAPI.",
      error: err.message || String(err),
    });
  }
});

// ------------------------
// Live coin market values (still via CoinGecko)
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
    console.error("Coin prices error:", err.message || err);
    res.status(500).json({
      ok: false,
      message: "Failed to load live coin prices.",
      error: err.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
