-- Port of parsers/drupal_watchdog.py + aggregate.aggregate() for drupal-watchdog.
-- Param: {glob:String} daily files. One row per fingerprint.
WITH
lines AS (
  SELECT _file AS file, _row_number AS rn, line,
         match(line, '^\\w{3}\\s+\\d+\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\S+\\s+[^:]+:') AS is_header
  -- Python reads text mode (universal newlines), so CRLF arrives as LF.
  -- Python decodes with errors='replace': invalid UTF-8 becomes U+FFFD (see README).
  FROM (SELECT _file, _row_number, toValidUTF8(replaceRegexpOne(line, '\\r$', '')) AS line
        FROM file({glob:String}, 'LineAsString', 'line String'))
  WHERE match(line, '\\S')
),
-- Headerless lines are rare (hundreds per month). Find each one's owning header (the
-- nearest earlier header in the same file) with an ASOF join over narrow header rows,
-- then stream every header line through, attaching its continuations from that small set.
-- Lines before a file's first header have no owner: each is its own degraded event.
conts AS (
  SELECT c.file AS file, c.rn AS rn, c.line AS line, ifNull(h.hrn, 0) AS owner  -- no match: 0 or NULL
  FROM (SELECT file, rn, line FROM lines WHERE NOT is_header) AS c
  ASOF LEFT JOIN (SELECT file, rn + 1 AS hrn FROM lines WHERE is_header) AS h
    ON c.file = h.file AND c.rn + 1 > h.hrn
),
owned AS (
  SELECT file, owner - 1 AS header_rn, arrayMap(x -> x.2, arraySort(groupArray((rn, line)))) AS conts
  FROM conts WHERE owner > 0
  GROUP BY file, owner
),
events AS (
  SELECT l.file AS file, l.rn AS first_rn, true AS has_header, l.line AS header,
         o.conts AS conts, l.line AS only_line
  FROM (SELECT file, rn, line FROM lines WHERE is_header) AS l
  LEFT JOIN owned AS o ON l.file = o.file AND l.rn = o.header_rn
  UNION ALL
  SELECT file, rn AS first_rn, false AS has_header, '' AS header,
         CAST([] AS Array(String)) AS conts, line AS only_line
  FROM conts WHERE owner = 0
),
parsed AS (
  SELECT file, first_rn, has_header,
         extractGroups(header, '^(\\w{3}\\s+\\d+\\s+\\d{2}:\\d{2}:\\d{2})\\s+(\\S+)\\s+([^:]+):\\s*(.*)$') AS g,
         splitByChar('|', g[4]) AS parts,
         drover_strip(arrayStringConcat(arraySlice(parts, 9), '|')) AS head_msg,
         if(has_header, nullIf(parts[3], ''), NULL) AS channel,
         if(has_header,
            drover_strip(arrayStringConcat(arrayConcat([head_msg], arrayMap(c -> drover_strip(c), conts)), ' ')),
            only_line) AS message,
         if(has_header, arrayStringConcat(arrayConcat([header], conts), '\n'), only_line) AS raw,
         lowerUTF8(ifNull(channel, '')) AS lc,
         lowerUTF8(head_msg) AS lm,
         if(NOT has_header, 'unknown',
           multiIf(
             lc IN ('php'), 'error',
             lc IN ('cron', 'system', 'ban', 'user_warning'), 'warning',
             lc = 'page not found', 'info',
             lc = 'access denied', 'notice',
             startsWith(lm, 'emergency:') OR position(lm, 'fatal error') > 0, 'critical',
             startsWith(lm, 'error:') OR position(lm, 'exception') > 0, 'error',
             startsWith(lm, 'warning:'), 'warning',
             startsWith(lm, 'notice:'), 'notice',
             'unknown')) AS severity,
         -- Syslog has no year. ch_aggregate resolves 'syslog|<file day>|<Mon>|<DD>' with drover's
         -- own parse_syslog_ts(); there are only a few such keys per file. A clock Python's
         -- datetime() would reject makes the day unknown, as in Python.
         -- Python's str.split(): Unicode whitespace (load_sql rewrites \\s).
         splitByRegexp('\\s+', g[1]) AS tsp,
         splitByChar(':', tsp[3]) AS hms,
         if(has_header AND toUInt8OrZero(hms[1]) < 24 AND toUInt8OrZero(hms[2]) < 60 AND toUInt8OrZero(hms[3]) < 60,
            concat('syslog|', toString(drover_file_day(file)), '|', tsp[1], '|', tsp[2]), 'unknown') AS day_key
  FROM events
),
-- Group on the request-id-normalized message first, then run the rest of normalize()
-- once per distinct value: most lines differ only by request id.
fine AS (
  SELECT channel, drover_normalize_reqid(message) AS m0, day_key, severity, count() AS n,
         min((file, first_rn)) AS first_key,
         argMin(substringUTF8(message, 1, 240), (file, first_rn)) AS first_summary,
         groupArraySorted(3)((file, first_rn, raw)) AS first_samples
  FROM parsed
  GROUP BY file, channel, m0, day_key, severity
)
-- buckets: one (day key, severity, channel, count, first occurrence) per file sub-group, so
-- ch_aggregate can rebuild Python's encounter order: group channel, severity ties, group order.
SELECT drover_fp(concat('watchdog:', ifNull(channel, ''), ':', drover_normalize_rest(m0))) AS fingerprint,
       sum(n) AS count,
       argMin(first_summary, first_key) AS summary,
       arrayMap(x -> x.3, arraySlice(arraySort(arrayFlatten(groupArray(first_samples))), 1, 3)) AS samples,
       groupArray((day_key, severity, channel, n, first_key)) AS buckets
FROM fine
GROUP BY fingerprint
FORMAT JSONEachRow
