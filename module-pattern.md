# The Shared Skeleton of the Nine Per-Ticker Modules

This document describes the common structure that the nine per-ticker data
capabilities in `main.py` share — *the skeleton*, not what any one of them
fetches or calculates. Wherever the nine do **not** agree on a point, that is
called out explicitly with a count of how many do it each way.

The nine capabilities, and the function that implements each:

| # | Capability            | Function (in `main.py`)   | Banner in file        |
|---|-----------------------|---------------------------|-----------------------|
| 1 | Quotes                | `get_quote`               | `MODULE 2: QUOTE`     |
| 2 | Financials            | `get_financials`          | `MODULE 3: FINANCIALS`|
| 3 | Technicals            | `get_technicals`          | `MODULE 4: TECHNICALS`|
| 4 | Options               | `get_options_flow`        | `MODULE 5: OPTIONS FLOW`|
| 5 | SEC insider filings   | `get_insider_activity`    | `MODULE 6: INSIDER ACTIVITY`|
| 6 | News sentiment        | `get_news_sentiment`      | `MODULE 7: NEWS & SENTIMENT`|
| 7 | Peers                 | `get_peers`               | `MODULE 8: PEERS`     |
| 8 | Earnings              | `get_earnings`            | `MODULE 9: EARNINGS`  |
| 9 | Analyst ratings       | `get_analyst_ratings`     | `MODULE 10: ANALYST RATINGS`|

> A note on the numbering: the in-file banner comments number the modules 1–10,
> because there is a tenth sibling, `get_company` (`MODULE 1: COMPANY PROFILE`),
> built the same way. It is not one of the nine you asked about, so it is left
> out of the analysis below — but if you grep the file and see "MODULE 1" and
> "MODULE 10," that is why the nine show up as modules 2 through 10.

---

## Part 1 — What ALL nine share (the skeleton)

These six things are true of every one of the nine, with no exceptions.

1. **Each is a single top-level function**, defined at the outermost level of
   the file (not nested inside a class or another function), and each sits
   directly under a banner comment of the form `# === MODULE N: NAME ===`.

2. **Each is named `get_<something>`** in lowercase-with-underscores
   ("snake_case"): `get_quote`, `get_financials`, `get_technicals`, and so on.
   The name is always "`get_`" followed by a plain-English noun for the
   capability. The name also lines up with the slot it fills in the final
   result (drop the `get_` and you get the key — `get_quote` → `"quote"`,
   `get_options_flow` → `"options_flow"`).

3. **Each declares that it returns a dictionary** (the type hint `-> dict` is on
   all nine). In plain terms, every module hands back one labelled bag of
   values.

4. **The returned dictionary comes in one of two shapes:**
   - **Success:** a flat bag of labelled results (numbers, text, and nested
     lists/bags).
   - **Failure:** a single-entry bag `{"error": "<description of what went wrong>"}`.

   This `{"error": ...}` shape is the universal "something broke" signal. The
   caller can always tell success from failure by checking for an `error` key.

5. **Each wraps its entire body in one big safety net.** Every module is
   structured as:

   ```
   def get_something(...):
       try:
           ... do the work ...
           return { ...results... }
       except Exception as e:
           return {"error": str(e)}
   ```

   So no matter what goes wrong inside, the module never crashes the program —
   it converts the problem into the `{"error": ...}` shape and returns normally.

6. **Each is called from the same two places, and always one-at-a-time (in
   sequence, never in parallel).** See Part 2.

---

## Part 2 — How the nine are invoked (dispatch)

There are **two** dispatch sites, both at the top of the file, and both run the
nine **sequentially** — one finishes before the next begins. Nothing about the
nine runs in parallel.

**Dispatch site A — the plain endpoint `analyze()` (`/analyze/{ticker}`).**
It fetches the ticker's base data once (`stock = yf.Ticker(ticker)` and
`info = stock.info`), checks the ticker is real, then assigns each module's
result into a slot, in order, line after line:

```
result["quote"]           = get_quote(info, mode)
result["financials"]      = get_financials(stock, info)
result["technicals"]      = get_technicals(stock)
result["options_flow"]    = get_options_flow(stock, info, mode)
result["insider_activity"]= get_insider_activity(ticker)
result["news_sentiment"]  = get_news_sentiment(ticker)
result["peers"]           = get_peers(ticker, info)
result["earnings"]        = get_earnings(stock, info)
result["analyst_ratings"] = get_analyst_ratings(stock, info)
```

**Dispatch site B — the streaming endpoint `analyze_stream()`
(`/analyze/stream/{ticker}`).** Same base fetch, but it walks a list called
`STREAM_MODULES` and, for each entry, sends the browser a "now fetching…"
message, runs the matching module through an inner `run(key)` chooser (a chain of
`if key == "quote": return get_quote(...)` lines), then sends a "…done, here is
the data" message. This is a `for` loop: still strictly one module at a time.

**Where the two dispatch sites disagree:** they run the nine in a **different
order**. The plain endpoint runs analyst ratings **last**; the streaming
endpoint runs it **second** (grouped right after financials so the UI can show
both under one "Financials" progress row). Both orders are sequential; only the
sequence differs.

**One reused efficiency, shared by both:** the expensive base lookups
(`yf.Ticker(...)` and its `.info`) are done **once** per request and handed to
the modules, rather than each module re-fetching them.

---

## Part 3 — Where the nine do NOT agree

The skeleton above is genuinely shared. Everything in this section is a point
where the nine diverge. Each sub-section gives the split and the counts.

### 3a. What input each takes (their "call signature")

All nine return a dictionary, but they do **not** take the same inputs. There
are **six different input shapes** across the nine:

| Input shape | Meaning in plain terms | Modules | Count |
|-------------|------------------------|---------|-------|
| `(info, mode)` | the pre-fetched data bag + free/premium flag | `get_quote` | 1 |
| `(stock, info)` | the live data handle + the pre-fetched bag | `get_financials`, `get_earnings`, `get_analyst_ratings` | 3 |
| `(stock, info, mode)` | both of the above + the flag | `get_options_flow` | 1 |
| `(stock)` | only the live data handle | `get_technicals` | 1 |
| `(ticker)` | only the bare ticker string | `get_insider_activity`, `get_news_sentiment` | 2 |
| `(ticker, info)` | the bare ticker string + the pre-fetched bag | `get_peers` | 1 |

Reading the same facts a different way:

- **Take the pre-fetched data bag (`info`):** 6 of 9 — quote, financials,
  options, peers, earnings, analyst ratings. The other 3 (technicals, insider,
  news) do not.
- **Take the live data handle (`stock`):** 5 of 9 — financials, technicals,
  options, earnings, analyst ratings.
- **Take only the bare ticker string:** 3 of 9 — insider, news, peers (peers
  also takes `info`).
- **Take the free/premium `mode` flag:** 2 of 9 — quote and options. The other
  7 ignore mode entirely; they behave identically in free and premium.

There is a meaningful pattern hiding in this: **the three modules that accept
the bare `ticker` string (insider, news, peers) are exactly the three that go
out and fetch their own data** from somewhere other than the shared yfinance
objects. The modules that are handed `stock`/`info` simply transform data the
caller already fetched. (More on this in 3e.)

### 3b. How each is built internally (decomposition & helper naming)

Every one of the nine is a single `get_…` function, but they are **not** equally
self-contained. How the work is broken up varies:

- **Flat, no helpers at all:** 4 of 9 — `get_quote`, `get_earnings`,
  `get_analyst_ratings`, `get_insider_activity`. Everything happens in the one
  function body.
- **Use small helper functions defined *inside* themselves** (private, local,
  invisible to the rest of the file): 2 of 9 — `get_financials` (defines
  `safe_row`, `to_list`, `pct_change` inside itself) and `get_peers` (defines
  `fetch_peer` inside itself).
- **Lean on separate, file-level helper functions:** 3 of 9 —
  - `get_technicals` is by far the most decomposed: it delegates to six
    file-level `compute_*` helpers (`compute_fibonacci`,
    `compute_psych_levels`, `compute_regression_channel`,
    `compute_candle_patterns`, `compute_chart_patterns`, `compute_pe_history`),
    which in turn use small utilities like `_find_pivots` and `_ovr`.
  - `get_news_sentiment` delegates to one file-level helper,
    `_ai_news_sentiment`.
  - `get_options_flow` calls one file-level sibling, `get_options_flow_premium_demo`,
    but only when `mode == "premium"`.

The **helper-naming conventions** themselves are consistent by role:
`compute_*` for the deterministic technical-overlay math; a leading underscore
(`_ovr`, `_fib_label`, `_find_pivots`, `_ai_news_sentiment`) for "private,
internal use only"; and `get_*_demo` for the fake/premium data generators.

### 3c. How each handles an API failure

This is the most consistent of the failure behaviors. **All nine** rely on the
same outer safety net described in Part 1: an unexpected failure anywhere in the
body is caught and returned as `{"error": "<message>"}`. So at the top level,
all nine handle a hard failure identically.

They differ in how much **partial** failure they tolerate *before* giving up.
Most of them wrap risky sub-steps in their own smaller safety nets that quietly
skip the broken piece and keep going, so a single bad row doesn't sink the whole
module:

- **Swallow inner failures and continue with partial data:** 6 of 9 — options
  (skips any expiry or the max-pain calc that fails), insider (skips any single
  filing that won't parse), news (skips the news call, the sentiment call, or
  the AI scoring independently), peers (skips the peer-list call and any single
  peer that won't load), earnings (skips the calendar parse), analyst ratings
  (skips the upgrades/downgrades history). Technicals also does this inside each
  of its `compute_*` helpers (each returns "nothing" instead of failing).
- **No inner safety nets — one body, one outer net:** quote and financials do
  their work in a single straight-through block; any failure goes straight to
  the one outer `{"error": ...}`.

There is also a small **double-guard at dispatch site B (streaming)**: that
endpoint wraps *each* module call in its own try/except as well, so even if a
module somehow failed to catch its own error, the stream would still turn it into
`{"error": ...}` and move on. The plain endpoint (site A) has one try/except
around the whole sequence, relying on each module to catch its own problems.

### 3d. How each handles a timeout

This is where the nine **disagree the most starkly.** A "timeout" means telling
a slow network call to give up after N seconds.

- **Sets explicit timeouts in this file:** 1 of 9 — only `get_insider_activity`.
  It is the only module that makes raw web requests itself, and it caps them at
  10 seconds (company list), 10 seconds (filing index), and 8 seconds (each
  individual filing).
- **Sets no timeout of its own:** 8 of 9. The yfinance-based modules (quote,
  financials, technicals, options, earnings, analyst ratings) and the
  Finnhub/yfinance-based ones (news, peers) never specify a timeout in this
  code; they inherit whatever default the underlying library uses. As written,
  nothing in `main.py` would force those calls to give up — if the upstream
  library hung, the only backstop is the eventual exception (if one ever
  arrives), caught by the outer net.

So: **1 module controls its own timeouts; 8 leave it entirely to their
libraries.**

### 3e. How each handles an empty result

"Empty result" means the upstream source returned nothing useful (no price
history, no filings, no peers, etc.). The nine split into two camps:

- **Return an explicit `{"error": ...}` when their primary source comes back
  empty:** 3 of 9 —
  - `get_technicals` → `{"error": "No price history"}` if the history is empty.
  - `get_options_flow` → `{"error": "No options data"}` if there are no expiries.
  - `get_insider_activity` → `{"error": "CIK not found for ticker"}` if the
    company can't be located in SEC's index.
- **Return a normal success dictionary, just full of blanks** (empty lists,
  `None`s, zeros, or a fallback): 6 of 9 — quote, financials, news, peers,
  earnings, analyst ratings. These never signal "empty" as an error; for
  example, earnings with no history returns zero counts and an empty list, and
  news with no articles returns an empty article list with an empty sentiment
  bag.

One of those six is special: **`get_peers` is the only module of the nine with a
hard-coded fallback dataset.** If the live peer lookup returns nothing, it falls
back to a built-in table of sector-mate tickers rather than returning blanks.

### 3f. How each accesses its external API client and keys

The nine pull from up to four outside sources, and they obtain credentials and
clients in noticeably different ways.

**By data source:**

- **yfinance (no API key needed):** the primary source for 6 of 9 — quote,
  financials, technicals, options, earnings, analyst ratings. Two more (news,
  peers) use it as a fallback.
- **SEC EDGAR (no key, just an identifying header):** 1 of 9 — insider.
- **Finnhub (needs a key):** 2 of 9 — news and peers (each as their *first*
  choice, before falling back to yfinance / the hard-coded table).
- **Anthropic / Claude (needs a key):** reached by 1 of 9 — news only, and only
  through its `_ai_news_sentiment` helper, as a last-resort way to score
  headlines.

**By how the client/credentials are obtained — three distinct mechanisms:**

1. **No client and no key at all — just transform what the caller handed in.**
   6 of 9 — quote, financials, technicals, options, earnings, analyst ratings.
   These operate on the `stock`/`info` objects passed down from the endpoint, so
   they never construct a client or read a key themselves.
2. **A module-level shared constant/client created once at startup.** Two such
   globals exist:
   - `SEC_HEADERS` (an identifying User-Agent string) — used only by insider.
   - `ANTHROPIC_CLIENT` (built once at import time from `ANTHROPIC_API_KEY` in
     the environment) — among the nine, reached only by news (via its helper).
3. **A key read from the environment *inside the function*, used to build a
   fresh client on each call.** 2 of 9 — news and peers. Both do the same thing:
   read `FINNHUB_API_KEY` with `os.getenv(...)` in the body, and — only if the
   key is present — do a local `import finnhub` and construct a brand-new
   `finnhub.Client(...)` right there.

**Where keys come from in all cases:** the `.env` file, loaded once at startup
via `load_dotenv()`, then read with `os.getenv(...)`. The difference is *when*:
the Anthropic key is read **once at import** (baked into the global client); the
Finnhub key is read **fresh on every call**, inside the function that needs it.

A related small inconsistency: three modules use **lazy local imports** —
pulling a library in mid-function rather than at the top of the file —
`import finnhub` inside news and peers, and `import re` inside insider. The other
six rely solely on the imports declared at the top of the file.

---

## Part 4 — One-page reference table

"✓ shared" = behaves the same across the row. Counts in the header rows show the
split where they differ.

| Module | Inputs | Returns | Outer safety net → `{"error":…}` | Sets own timeout? | Empty result → | Own client/key? |
|--------|--------|---------|------------------------|-------------------|----------------|------------------|
| `get_quote`           | `info, mode` | dict | ✓ | no | blank dict | none (uses caller's `info`) |
| `get_financials`      | `stock, info` | dict | ✓ | no | blank dict | none (uses caller's objects) |
| `get_technicals`      | `stock` | dict | ✓ | no | **`{"error":…}`** | none (uses caller's `stock`) |
| `get_options_flow`    | `stock, info, mode` | dict | ✓ | no | **`{"error":…}`** | none (+ demo sibling in premium) |
| `get_insider_activity`| `ticker` | dict | ✓ | **yes (10/10/8s)** | **`{"error":…}`** | module-level `SEC_HEADERS`, no key |
| `get_news_sentiment`  | `ticker` | dict | ✓ | no | blank dict | reads `FINNHUB_API_KEY` per call; global `ANTHROPIC_CLIENT` |
| `get_peers`           | `ticker, info` | dict | ✓ | no | blank dict (hard-coded fallback list) | reads `FINNHUB_API_KEY` per call |
| `get_earnings`        | `stock, info` | dict | ✓ | no | blank dict | none (uses caller's objects) |
| `get_analyst_ratings` | `stock, info` | dict | ✓ | no | blank dict | none (uses caller's objects) |

**The bottom line:** the nine agree completely on four things — they are all
top-level `get_<noun>() -> dict` functions under `MODULE` banners, they all
return either a results-bag or an `{"error": …}` bag, they all wrap everything
in one outer safety net, and they are all dispatched one-at-a-time (never in
parallel) from the same two endpoints. They disagree on almost everything else:
the inputs they accept (6 different signatures), whether they react to the
free/premium flag (2 yes, 7 no), how they are broken into helpers (4 flat, 2
with internal helpers, 3 leaning on file-level helpers), whether they set their
own network timeouts (1 yes, 8 no), whether an empty result is an error or a
blank (3 error, 6 blank), and how they reach their data and credentials (6 use
no client/key, 1 a header constant, 2 read a key fresh each call, 1 a startup
global).

---

## Rules for a new module

Everything above this section describes what the nine modules currently do,
warts and all. This section is different: it lays down the rules a **tenth**
module must follow. Where the nine disagree, these rules pick the answer. Build
the next one this way.

### 1. Every module is either a fetcher or a transformer

There are exactly two kinds of module, and a new one must be one of them.

- A **fetcher** goes and gets its own data from an outside service. It takes the
  bare ticker string, makes the external call itself, puts an explicit
  **10-second timeout** on that call, and keeps its API key or login details in
  one named constant declared once **near the top of the file** (not read fresh
  in the middle of the function).
- A **transformer** does no fetching of its own. It takes the already-fetched
  `stock`/`info` objects the endpoint hands it, and it sets **no timeout**
  (there is no network call of its own to time out).

**The deciding test:** if the module reaches out and gets its own external data,
it is a fetcher. If it only reshapes data the endpoint has already fetched, it
is a transformer.

### 2. Finding nothing is a success, not an error

If a module runs cleanly but simply finds nothing to report, that is a normal
result. It returns its usual dictionary structure with the relevant list left
empty, plus a short, human-readable note explaining the emptiness — for example,
"No disclosed congressional trades for this ticker in the lookback window."

The `{"error": ...}` bag is reserved **only for genuine failures**: the API
being unreachable, a bad or missing key, an outright crash. "I looked and there
was nothing there" is not a failure.

### 3. Dispatch order does not matter

A new module gets added to the end of both `analyze()` and `analyze_stream()`.
Where it sits relative to the other modules in those lists makes no difference —
do not agonize over its position.

### 4. Internal structure is up to you

A module may break its work into helper functions or stay as one flat block —
whatever its own logic calls for. This is deliberately not standardized, so
match the shape to the job rather than to a template.
