(function () {
  'use strict';

  const groups = [
    {
      title: 'Fundamentals',
      questions: [
        [1, 'What is PySpark, and how is it different from Apache Spark?', `<p>Apache Spark is a distributed processing engine. PySpark is its Python API. In the standard PySpark driver, Python communicates with the JVM through Py4J; Spark SQL plans and most built-in DataFrame execution run in the JVM. Python UDFs are an important exception: their functions run in Python workers and require data serialization across the boundary.</p><p>So PySpark is not simply “Spark running in pure Python.” The API language and the execution engine are different concerns.</p>`],
        [2, 'What is the difference between an RDD and a DataFrame?', `<p>An RDD is a low-level distributed collection of objects with function-based operations. A DataFrame is a distributed, named-column table with a schema and a relational query plan. DataFrames let Spark SQL apply optimizations such as Catalyst plan optimization and generated code, so they are usually the better starting point for structured data.</p><p>Use RDDs when you truly need low-level control or are processing unstructured objects; prefer DataFrames for ETL, SQL, and analytics.</p>`],
        [3, 'What are transformations and actions in Spark?', `<p>Transformations describe a new dataset or query plan; they are generally lazy. Examples include <code>filter</code>, <code>select</code>, <code>join</code>, and RDD <code>map</code>. Actions request a result or output and trigger execution, such as <code>count</code>, <code>collect</code>, <code>show</code>, or writing a DataFrame.</p><p>For example, <code>df.filter("active = true").select("id")</code> builds work; <code>count()</code> executes it.</p>`],
        [4, 'What is lazy evaluation?', `<p>Spark records transformations as a logical plan instead of running each one immediately. When an action needs a result, Spark optimizes the plan, creates stages around shuffle boundaries, and schedules tasks. This lets Spark combine and optimize work before execution.</p>`],
        [5, 'What is SparkSession?', `<p><code>SparkSession</code> is the main entry point for DataFrames and Spark SQL. It provides access to reading and writing data, SQL queries, catalog operations, and configuration. It unified APIs previously exposed through <code>SQLContext</code> and <code>HiveContext</code>.</p><pre><code>from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("etl").getOrCreate()</code></pre>`],
        [6, 'What is a partition in Spark?', `<p>A partition is a chunk of a distributed dataset. In a stage, Spark normally runs one task per partition, allowing partitions to be processed in parallel. The right number and size depend on data volume, cluster resources, and the operations being performed; too few limits parallelism, while too many can create scheduling and small-file overhead.</p>`],
        [7, 'What is the difference between map() and flatMap()?', `<p><code>map</code> produces one output per input. <code>flatMap</code> can produce zero or more outputs per input and flattens those outputs into one sequence.</p><pre><code>lines = sc.parallelize(["red blue", "green"])
words = lines.flatMap(lambda line: line.split(" "))
# ["red", "blue", "green"]</code></pre>`],
        [8, 'What are cache() and persist()?', `<p>Both mark a dataset for reuse across actions. <code>cache()</code> uses the API's default storage level; <code>persist(level)</code> lets you choose one. In PySpark, the DataFrame default is memory-and-disk deserialized storage, while RDD <code>cache()</code> defaults to memory-only. Check the exact API and Spark version when the storage level matters. Caching is useful when recomputing an expensive dataset that is actually reused, not as a default for every intermediate.</p>`],
        [9, 'What are narrow and wide transformations?', `<p>A narrow transformation can compute an output partition from a small number of input partitions without redistributing records across the cluster; examples include <code>map</code> and many <code>filter</code> operations. A wide transformation requires data from multiple input partitions to be redistributed, usually causing a shuffle; examples include many joins and aggregations.</p>`],
        [10, 'What is a shuffle, and why is it expensive?', `<p>A shuffle redistributes records between partitions, often by key. Spark may serialize and write intermediate data, transfer it over the network, and read or merge it on other executors. This costs network, disk, and CPU time and can expose skew. Use the Spark UI to inspect shuffle read/write, spill, and task-time variation.</p>`],
        [11, 'What is a DataFrame schema?', `<p>A schema describes column names, data types, and nullability. Providing an explicit schema can avoid the extra scan needed for inference, make input expectations clear, and catch incompatible data early. It is not a blanket performance fix: the main benefit is predictable parsing and validation.</p><pre><code>from pyspark.sql.types import StructType, StructField, StringType, LongType

schema = StructType([
    StructField("customer_id", StringType(), False),
    StructField("amount", LongType(), True),
])
df = spark.read.schema(schema).option("header", True).csv(path)</code></pre>`],
        [12, 'How do you handle null values in PySpark?', `<p>Use <code>fillna</code> when a documented default is appropriate, <code>dropna</code> when incomplete rows should be excluded, and <code>isNull</code>/<code>isNotNull</code> for explicit filtering. Choose based on the meaning of each field rather than applying one rule everywhere. Floating-point <code>NaN</code> is distinct from SQL <code>NULL</code> and may need separate handling.</p><pre><code>from pyspark.sql.functions import col

clean = df.filter(col("customer_id").isNotNull())
filled = clean.fillna({"country": "unknown"})</code></pre>`],
        [13, 'How do DataFrame groupBy() and RDD reduceByKey() differ?', `<p><code>groupBy</code> on a DataFrame creates a relational grouping; pair it with aggregations such as <code>sum</code> or <code>count</code>. <code>reduceByKey</code> is an RDD operation for key-value pairs and can combine values locally before the shuffle when the reduction is associative and commutative. They are different APIs, but both may require redistribution by key.</p>`],
        [14, 'How do you read a CSV file in PySpark?', `<p>Use <code>spark.read.csv</code> or the format-based reader. In production, set the header and an explicit schema where practical; also decide how malformed records, quoting, encoding, and null markers should be handled.</p><pre><code>df = (spark.read
    .option("header", True)
    .schema(schema)
    .csv("/data/input.csv"))</code></pre>`],
        [15, 'What is Parquet, and why is it common in data lakes?', `<p>Parquet is a columnar file format. Column storage, compression, and statistics can reduce I/O when queries read only some columns or filter data. It also carries schema information and is supported across many analytics engines. Benefits depend on sensible file sizes, layout, and query patterns.</p>`]
      ]
    },
    {
      title: 'Intermediate',
      questions: [
        [16, 'What is the Catalyst Optimizer?', `<p>Catalyst is Spark SQL's query-optimization framework. It analyzes and rewrites logical plans, then helps choose a physical plan. Depending on the query and data-source capabilities, optimizations can include predicate and projection pushdown, constant folding, and join planning. Inspect <code>explain()</code> and runtime metrics rather than assuming a rewrite occurred.</p>`],
        [17, 'What is Tungsten in Spark?', `<p>Tungsten was the name for Spark SQL execution improvements focused on CPU and memory efficiency, including binary processing and code generation. In current Spark versions, these ideas appear in the execution engine; it is more accurate to discuss features such as whole-stage code generation and off-heap options than to treat Tungsten as a separate engine that every query uses.</p>`],
        [18, 'What is the difference between cache() and persist()?', `<p><code>cache()</code> selects the API's default persistence level; <code>persist()</code> accepts an explicit storage level, such as memory-and-disk. For DataFrames, the default is memory-and-disk deserialized storage in current Spark versions. Persist only when a costly result will be reused, and unpersist it when finished if it occupies needed resources.</p>`],
        [19, 'What is data skew, and how do you address it?', `<p>Skew occurs when a few keys or partitions contain much more data than the rest, leaving a small number of tasks as stragglers. First confirm it in the Spark UI and task metrics. Options include handling skewed joins with Adaptive Query Execution, broadcasting a genuinely small side, salting hot keys when semantics allow, or revisiting the partitioning and aggregation strategy. Repartitioning alone does not split a single hot key for a key-based operation.</p>`],
        [20, 'What is the difference between repartition() and coalesce()?', `<p><code>repartition(n)</code> redistributes data with a shuffle and can increase or decrease the partition count. <code>coalesce(n)</code> typically reduces partitions with less data movement and cannot increase the count; it can leave uneven partitions. Choose based on downstream parallelism and output-file needs, not just the smallest task count.</p>`],
        [21, 'What is a broadcast join?', `<p>A broadcast join sends a small relation to executors so the large side can join locally, avoiding a shuffle of that large side. Spark may choose one automatically, or you can hint it when you know the size is safe.</p><pre><code>from pyspark.sql.functions import broadcast

result = facts.join(broadcast(country_lookup), "country_id")</code></pre><p>Validate the actual serialized size and executor memory; broadcasting an unexpectedly large table can cause memory pressure.</p>`],
        [22, 'How does Spark provide fault tolerance?', `<p>Spark can recompute lost partitions from the lineage of transformations and the available input data. For streaming state or very long lineages, checkpoints can save state or truncate recomputation history. Recovery still depends on reliable sources, checkpoint storage, and sink semantics; lineage does not protect against every external-system failure.</p>`],
        [23, 'What is a window function in PySpark?', `<p>A window function computes a value across related rows while keeping each row in the result. Define a partition and ordering, then apply a function such as rank, lag, or a running sum.</p><pre><code>from pyspark.sql import Window
from pyspark.sql.functions import rank

window = Window.partitionBy("dept").orderBy("salary")
ranked = df.withColumn("salary_rank", rank().over(window))</code></pre>`],
        [24, 'Why is reduceByKey() often preferred to groupByKey()?', `<p>For an associative and commutative aggregation, <code>reduceByKey</code> can combine values on each mapper before shuffling, so less data may cross the network. <code>groupByKey</code> gathers all values for each key and can use much more memory. Use <code>groupByKey</code> only when the actual collection of values is required; otherwise choose an aggregation such as <code>reduceByKey</code> or <code>aggregateByKey</code>.</p>`],
        [25, 'How do you investigate and optimize a slow Spark job?', `<p>Start with the Spark UI and the physical plan: identify the slow stage, long-tail tasks, skew, shuffle volume, spill, input size, and executor utilization. Then address the evidence: reduce unnecessary columns and rows early, use an appropriate join strategy, fix skew, tune partition counts, and avoid driver-heavy actions such as collecting a large result. Change one factor at a time and compare runtime metrics.</p>`],
        [26, 'What is partition pruning?', `<p>Partition pruning skips storage partitions that cannot match a filter. For example, if files are laid out by date and a query filters to one date, Spark can avoid listing and scanning other date partitions. It depends on the data being physically partitioned appropriately and the filter being usable by the scan.</p>`],
        [27, 'What is predicate pushdown?', `<p>Predicate pushdown passes supported filters to a data source so it can reject data earlier. With Parquet, Spark can use metadata and row-group statistics to skip some data, but this does not mean every unmatched row is individually avoided at the storage layer. Confirm pushdown in the physical plan and source metrics.</p>`],
        [28, 'How do Parquet and ORC compare?', `<p>Both are columnar formats with compression and query optimizations. Parquet has broad cross-engine support; ORC is common in Hive ecosystems and also provides strong compression and statistics. The better choice depends on the engines, catalog, and interoperability requirements in the platform, so benchmark with representative data.</p>`],
        [29, 'What are Spark accumulators?', `<p>Accumulators let tasks add values that the driver can inspect, commonly for diagnostics or simple metrics. They are not a reliable way to control business logic: task retries or transformations that are evaluated more than once can make updates surprising. Use data outputs or a proper metrics system when correctness matters.</p>`],
        [30, 'What are UDFs, and why can Python UDFs be slower?', `<p>A UDF applies custom logic that is not expressed with built-in Spark functions. A regular Python UDF crosses the JVM/Python boundary and can limit Spark SQL's ability to optimize the function. Prefer built-in expressions where possible. Pandas UDFs use Arrow and vectorized batches, which may help for suitable workloads, but should still be measured.</p><pre><code>from pyspark.sql.functions import upper

df = df.withColumn("name_upper", upper("name"))</code></pre>`]
      ]
    },
    {
      title: 'Advanced',
      questions: [
        [31, 'Walk through Spark execution from code to tasks.', `<p>For DataFrames, API calls build a logical query plan. An action triggers optimization and physical planning. Spark's scheduler divides work at shuffle boundaries into stages, then creates tasks for partitions and schedules them on executors. The driver coordinates; executors run tasks and may exchange shuffle data. The exact plan depends on the query and runtime information.</p>`],
        [32, 'What happens during a shuffle?', `<p>Records are partitioned for a downstream operation, often by key. Upstream tasks write shuffle blocks; downstream tasks fetch and merge the blocks, with sorting or aggregation as required. Network transfer, disk I/O, serialization, and skew can make this expensive. Inspect shuffle read/write, spill, and task-duration distributions in the Spark UI.</p>`],
        [33, 'How would you design a large-scale Spark ETL pipeline?', `<p>Clarify freshness, volume, correctness, and recovery requirements first. Use explicit schemas and incremental inputs where possible; validate and transform with built-in expressions; choose file format and partition columns for expected queries; control output file sizes; and make writes idempotent or transactional where the storage layer supports it. Add checkpoints for streaming state, data-quality checks, logging, and monitoring. Test with realistic skew and failure scenarios.</p>`],
        [34, 'What is Delta Lake, and what does it add?', `<p>Delta Lake is a table storage layer that uses a transaction log with data files to provide capabilities such as ACID transactions, schema enforcement and evolution, time travel, and merge operations. It is commonly used with Spark but is not simply a Spark-only feature. Check compatibility and concurrency behavior for the specific platform and table operations.</p>`],
        [35, 'What is Adaptive Query Execution (AQE)?', `<p>AQE uses runtime statistics to revise parts of a query plan while it runs. Depending on the Spark version and configuration, it can coalesce shuffle partitions, change join strategies, and handle skewed joins. AQE can reduce manual tuning, but it does not make poor data layout or every skew pattern disappear.</p>`],
        [36, 'What is the small-files problem?', `<p>Many tiny files increase listing and metadata overhead and create extra tasks, which can slow reads and strain catalogs. Address it by controlling write parallelism and partition cardinality, then compacting files as appropriate. <code>coalesce</code> can reduce output task count, but careless use may create uneven work or a bottleneck.</p>`],
        [37, 'How does Spark process streaming data?', `<p>Structured Streaming expresses streaming work with DataFrame APIs. The common micro-batch engine processes new input repeatedly and can maintain state with checkpoints; continuous processing is a separate mode with different support and guarantees. Sources, sinks, output modes, watermarks, and checkpoint configuration all affect the behavior.</p>`],
        [38, 'How does batch processing differ from streaming?', `<p>Batch processing operates on a bounded dataset and typically runs to completion. Streaming processes an unbounded input incrementally, maintaining progress and sometimes state over time. Streaming can reduce latency, but adds concerns such as event time, late data, checkpoint recovery, and sink guarantees. A system may combine both patterns.</p>`],
        [39, 'What is checkpointing in Spark?', `<p>Checkpointing saves data or streaming state to durable storage. For RDDs it can truncate long lineage; for Structured Streaming it stores progress and state needed for recovery. Use a durable, correctly configured checkpoint location and do not casually reuse it for a different query.</p>`],
        [40, 'How do you debug Spark failures in production?', `<p>Classify the failure first: driver or executor, deterministic or intermittent, and which stage or input caused it. Read the exception and executor logs, inspect the Spark UI for skew, spill, shuffle, and memory/GC signals, and compare the failed task with successful tasks. Reproduce on a bounded sample if possible, then fix the data or plan issue before changing resource settings.</p>`]
      ]
    },
    {
      title: 'Scenario-based',
      questions: [
        [41, 'How would you join a 1 TB dataset with a 5 MB lookup table?', `<p>A broadcast join is a strong candidate: broadcast the small lookup so the large side avoids a shuffle. First verify that the 5 MB estimate reflects its in-memory serialized size and that it fits comfortably on each executor. Compare the physical plan and runtime metrics; Spark may already select a broadcast join automatically.</p><pre><code>from pyspark.sql.functions import broadcast

joined = large.join(broadcast(lookup), "id")</code></pre>`],
        [42, 'A Spark job fails with out-of-memory errors. What do you do?', `<p>Find out whether the driver or an executor ran out of memory and inspect the failing stage. Look for oversized partitions, skew, large shuffles, unbounded state, caching pressure, or data being collected to the driver. Then address the cause: reduce data early, change join or partition strategy, handle hot keys, bound streaming state, or avoid <code>collect()</code>. Increase memory only when evidence shows a legitimate capacity need.</p>`],
        [43, 'How would you design incremental processing?', `<p>Identify a trustworthy change signal, such as a source watermark column, CDC feed, or source-system change log. Read only new or changed records, deduplicate as required, and apply idempotent writes or Delta <code>MERGE</code> operations. Persist progress safely and define how updates, deletes, retries, and late-arriving records are handled. Event-time watermarks solve a related streaming-state problem; they are not a general batch-incremental strategy.</p>`],
        [44, 'How do you validate data quality in a Spark ETL pipeline?', `<p>Define checks from the data contract: schema and required fields, valid ranges, uniqueness, referential integrity, and reconciled counts or totals. Decide which failures stop the pipeline and which records are quarantined. Emit metrics and samples of rejected data, and make retries safe so a validation failure does not silently publish partial or invalid output.</p>`],
        [45, 'How do you handle late-arriving data in Structured Streaming?', `<p>Use event-time columns and a watermark that reflects the lateness the application is willing to accept. For stateful aggregations, the watermark helps bound retained state and determines when old results can be finalized; data later than the threshold may not update that state. Choose the threshold and output mode from business requirements, and verify source, checkpoint, and sink behavior during recovery.</p>`]
      ]
    }
  ];

  const root = document.getElementById('pyspark-questions');
  if (!root) return;

  groups.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'pyspark-group';

    const heading = document.createElement('h3');
    heading.className = 'h4 pyspark-group-title';
    heading.textContent = group.title;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'pyspark-list';
    group.questions.forEach(([number, prompt, answer]) => {
      const item = document.createElement('details');
      item.className = 'pyspark-item';

      const summary = document.createElement('summary');
      const index = document.createElement('span');
      index.className = 'pyspark-number mono';
      index.textContent = String(number).padStart(2, '0');
      const question = document.createElement('span');
      question.className = 'pyspark-question';
      question.textContent = prompt;
      summary.append(index, question);

      const content = document.createElement('div');
      content.className = 'pyspark-answer';
      content.innerHTML = answer;
      item.append(summary, content);
      list.appendChild(item);
    });
    section.appendChild(list);
    root.appendChild(section);
  });

  document.querySelectorAll('[data-pyspark-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const expand = button.dataset.pysparkAction === 'expand';
      root.querySelectorAll('details').forEach((item) => { item.open = expand; });
    });
  });
})();
