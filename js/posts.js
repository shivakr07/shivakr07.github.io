/*
 * Blog posts. To publish a new post, add an object to this array:
 *   slug      — URL id, lowercase-with-dashes (blog.html?post=<slug>)
 *   category  — 'ai' | 'data' | 'software'
 *   date      — 'YYYY-MM-DD'
 *   title, summary
 *   body      — Markdown: #/##/### headings, paragraphs, - and 1. lists, > quotes,
 *               **bold**, *italic*, `code`, [links](https://…) and ```lang fenced code
 * Posts are sorted by date automatically; newest first.
 */
window.BLOG_CATEGORIES = {
  ai: { label: 'AI', long: 'Applied AI' },
  data: { label: 'Data engineering', long: 'Data engineering' },
  software: { label: 'Software development', long: 'Software development' }
};

window.BLOG_POSTS = [
  {
    slug: 'why-attention-divides-by-root-dk',
    category: 'ai',
    date: '2026-09-27',
    title: 'Why attention divides by √dₖ',
    summary: 'The one-line scaling factor in every Transformer exists to keep softmax out of saturation. Here is the variance argument, and what breaks without it.',
    body: `
Every Transformer computes attention as

\`\`\`python
weights = softmax(Q @ K.T / sqrt(d_k))
output  = weights @ V
\`\`\`

The division by √dₖ looks like a cosmetic constant. It is not. Without it, attention stops learning as models get wider.

## Dot products grow with dimension

Take one query vector q and one key vector k, each with dₖ components. Assume the components are independent, with mean 0 and variance 1 — roughly what you get after initialisation and layer normalisation.

Their dot product is a sum of dₖ terms:

\`\`\`python
q · k = q1*k1 + q2*k2 + ... + q_dk*k_dk
\`\`\`

Each product qᵢkᵢ has mean 0 and variance 1. Summing dₖ independent terms adds their variances, so **Var(q · k) = dₖ** and the standard deviation is √dₖ.

With dₖ = 64, typical attention scores are about ±8. With dₖ = 128, they are about ±11.

## Softmax saturates on large inputs

Softmax exponentiates its inputs. When the scores spread over a range of ±10, the largest score dominates: e¹⁰ is about 22,000 times e⁰. The output collapses towards a one-hot vector.

That matters for learning. The gradient of softmax is

\`\`\`python
d softmax_i / d z_j = s_i * (1[i == j] - s_j)
\`\`\`

When one sᵢ is close to 1 and the rest are close to 0, every term in that expression is close to 0. The layer is confidently attending to one token and can barely change its mind. Gradients vanish before training has found a good pattern.

## Dividing by √dₖ restores unit variance

Scaling a random variable by 1/√dₖ divides its variance by dₖ:

\`\`\`python
Var((q · k) / sqrt(d_k)) = d_k / d_k = 1
\`\`\`

So the scores entering softmax have a standard deviation of about 1 **regardless of head size**. Softmax stays in its sensitive range, the attention distribution stays soft early in training, and gradients keep flowing.

## You can see it in a few lines

\`\`\`python
import torch

for d_k in (16, 64, 256):
    q, k = torch.randn(10_000, d_k), torch.randn(10_000, d_k)
    raw = (q * k).sum(-1)
    print(d_k, raw.std().item(), (raw / d_k ** 0.5).std().item())
# 16   ~4.0   ~1.0
# 64   ~8.0   ~1.0
# 256  ~16.0  ~1.0
\`\`\`

The raw standard deviation doubles every time dₖ quadruples; the scaled one stays at 1.

## Why not another constant?

Dividing by dₖ would over-correct and flatten attention towards uniform, so every token would look equally relevant. √dₖ is exactly the factor that cancels the growth of the standard deviation. It is the same reasoning behind Xavier and He initialisation: keep activations at a stable scale so depth and width don't push them into saturation.

> The scaling factor is not about numerical precision. It keeps the gradient of softmax alive.

## Takeaways

- Unscaled dot-product scores have standard deviation √dₖ.
- Large scores saturate softmax and shrink its gradients towards zero.
- Dividing by √dₖ normalises the scores to unit variance for any head size.
- It is a design choice about **trainability**, not just stability.
`
  },
  {
    slug: 'metadata-driven-medallion-pipelines-in-fabric',
    category: 'data',
    date: '2026-09-27',
    title: 'Metadata-driven medallion pipelines in Microsoft Fabric',
    summary: 'Stop building one pipeline per table. A control table, three generic notebooks and a few rules for idempotency take you from ten sources to a hundred.',
    body: `
The first version of most lakehouses is a pipeline per source: copy this table, clean it, publish it. It works for five tables. At fifty, every schema change means editing code, and no two pipelines handle failures the same way.

The fix is to move *what* to load into metadata and keep *how* to load it in a small amount of generic code.

## The shape of the pattern

A medallion lakehouse has three layers:

- **Bronze** — raw data as it arrived, append-only, with load metadata.
- **Silver** — validated, typed, deduplicated records.
- **Gold** — business-ready models: facts, dimensions and aggregates.

In a metadata-driven design, each layer is served by **one parameterised notebook**, and a control table decides what each one processes.

## The control table

\`\`\`sql
CREATE TABLE meta.pipeline_config (
    source_id        STRING,
    source_system    STRING,   -- e.g. kusto, sql, api, files
    source_object    STRING,
    load_type        STRING,   -- full | incremental
    watermark_column STRING,
    primary_keys     STRING,   -- comma-separated
    target_table     STRING,
    is_active        BOOLEAN
);
\`\`\`

An orchestration pipeline in Data Factory or Fabric reads the active rows and fans out a ForEach activity, passing each row to the bronze notebook. Adding a source becomes an INSERT, not a deployment.

## Incremental loads with a watermark

For incremental sources, store the last successfully loaded value and only pull newer rows:

\`\`\`python
last = spark.sql(f"""
    SELECT MAX(watermark_value) FROM meta.watermarks
    WHERE source_id = '{source_id}'
""").first()[0]

df = read_source(cfg).filter(F.col(cfg.watermark_column) > F.lit(last))
\`\`\`

Only advance the watermark **after** the write commits. If the job fails halfway, the next run reprocesses the same window instead of skipping it.

## Make every layer idempotent

Retries are guaranteed in production, so a rerun must never duplicate data. In silver, merge on the primary keys instead of appending:

\`\`\`python
(DeltaTable.forName(spark, cfg.target_table).alias("t")
    .merge(updates.alias("s"), merge_condition(cfg.primary_keys))
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute())
\`\`\`

Delta Lake's transaction log makes each merge atomic, so a failed run leaves the table exactly as it was.

## Quarantine instead of failing

A single malformed row should not stop a thousand good ones. Validate on the way into silver and route failures to a quarantine table with the reason attached:

\`\`\`python
checks = F.col("event_time").isNotNull() & F.col("region").isin(valid_regions)
good, bad = df.filter(checks), df.filter(~checks)
bad.withColumn("reason", F.lit("schema_check")).write.mode("append").saveAsTable("quarantine.events")
\`\`\`

Alert on the quarantine rate, not on every bad row. A sudden jump usually means an upstream schema change.

## Keep gold fast

Gold tables are read constantly by semantic models and dashboards, so optimise them for reads:

- Model them as **star schemas**, with narrow facts and conformed dimensions.
- Partition by the column most queries filter on, usually a date.
- Compact small files regularly (OPTIMIZE) so scans stay efficient.
- Use incremental refresh in the semantic model so only recent partitions reload.

## What this buys you

- New sources are configuration, not code.
- Every table gets the same logging, retries and data-quality rules.
- Operational dashboards can report health for **all** pipelines from one set of logs.
- Reruns are safe by construction.

The upfront cost is a slightly more abstract first pipeline. The payoff arrives around the tenth source, and grows with every one after that.
`
  },
  {
    slug: 'token-bucket-rate-limiting-at-the-gateway',
    category: 'software',
    date: '2026-09-27',
    title: 'Rate limiting at the gateway with a token bucket',
    summary: 'How the token bucket algorithm allows short bursts while enforcing an average rate, how to size it, and how to make it correct across many gateway instances.',
    body: `
An API gateway is the natural place to protect your services from traffic they can't handle. The algorithm most gateways use for this is the **token bucket**. It is simple, cheap and — unlike a fixed request counter — friendly to bursty clients.

## The idea

Picture a bucket that holds at most **capacity** tokens. Tokens are added at a steady **refill rate** per second. Every request takes one token. If the bucket is empty, the request is rejected with \`429 Too Many Requests\`.

Two numbers describe the whole policy:

- **Refill rate** is the sustained average a client may use.
- **Capacity** is the largest burst you'll accept after a quiet period.

A client allowed 5 requests per second with a capacity of 10 can send 10 requests at once after being idle, then settles back to 5 per second.

## A minimal implementation

You don't need a timer to add tokens. Compute them lazily from the time elapsed since the last request:

\`\`\`js
class TokenBucket {
  constructor(capacity, refillPerSecond) {
    this.capacity = capacity;
    this.rate = refillPerSecond;
    this.tokens = capacity;
    this.last = Date.now();
  }

  tryRemove() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
\`\`\`

Keep one bucket per client key — an API key, a user ID or an IP address — and reject when \`tryRemove()\` returns false.

## Tell clients what happened

A good 429 response helps clients back off correctly instead of retrying immediately:

\`\`\`js
res.status(429)
   .set('Retry-After', String(Math.ceil((1 - bucket.tokens) / bucket.rate)))
   .json({ error: 'rate_limited' });
\`\`\`

Clients should combine \`Retry-After\` with exponential backoff and jitter, so thousands of them don't all retry at the same instant.

## Many gateway instances

In-memory buckets break as soon as you run more than one gateway: each instance grants the full allowance, so the real limit multiplies. The usual fix is to keep bucket state in **Redis** and update it atomically with a Lua script, so the read, refill and decrement happen as one operation:

\`\`\`js
const script = \`
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or ARGV[1])
local last   = tonumber(redis.call('HGET', KEYS[1], 'last') or ARGV[3])
tokens = math.min(tonumber(ARGV[1]), tokens + (tonumber(ARGV[3]) - last) * tonumber(ARGV[2]))
local allowed = tokens >= 1
if allowed then tokens = tokens - 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', ARGV[3])
redis.call('EXPIRE', KEYS[1], 3600)
return allowed and 1 or 0\`;
\`\`\`

Pass the current time from a single clock source in \`ARGV[3]\`, and let idle keys expire so memory stays bounded.

## Choosing the numbers

- Start from what the **downstream service** can sustain, not from what clients ask for.
- Set capacity to the largest legitimate burst, such as a page load that fires several calls at once.
- Use separate buckets for expensive endpoints like search and exports.
- Monitor your 429 rate. A steady trickle is healthy; a spike tells you either a client misbehaved or the limits are too tight.

## Where it fits

Rate limiting is the first line of defence, not the only one. Combine it with timeouts, circuit breakers and queues for work that can happen asynchronously. Together they turn "the service fell over" into "a few clients were asked to slow down" — which is exactly the failure mode you want.
`
  }
];
